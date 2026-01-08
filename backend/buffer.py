import asyncio
import logging
from typing import Dict, Optional

from .data import MultiFaceDataManager

logger = logging.getLogger(__name__)


class BufferManager:
    """Proactive buffer manager that prefetches timesteps into an in-memory cache.

    It runs a background asyncio loop that ensures timesteps (current_time+1 .. current_time+TARGET_BUFFER_SIZE)
    are present in `cache` as bytes returned by `DataManager.fetch_chunk`.
    """

    TARGET_BUFFER_SIZE = 15

    def __init__(self, data_manager: Optional[MultiFaceDataManager] = None, quality: int = 1):
        self.dm = data_manager or MultiFaceDataManager()
        self.quality = int(quality)
        self.cache: Dict[int, bytes] = {}
        self.current_time: Optional[int] = None
        self._task: Optional[asyncio.Task] = None
        self._wake = asyncio.Event()
        self._stopping = False
        logger.info("BufferManager initialized (quality=%s)", self.quality)

    def start(self):
        if self._task is None:
            # ensure stopping flag is cleared before starting
            self._stopping = False
            self._task = asyncio.create_task(self._run_loop())
            logger.info("BufferManager background task started")

    async def stop(self):
        self._stopping = True
        if self._task is not None:
            # wake up loop so it can exit, then cancel if it doesn't stop promptly
            self._wake.set()
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                logger.info("BufferManager task cancelled during stop")
            self._task = None
            logger.info("BufferManager stopped")

    def set_current_time(self, t: int):
        self.current_time = int(t)
        # wake up the background loop so it can adjust buffer
        self._wake.set()
        logger.info("BufferManager current_time set to %s", self.current_time)

    def get_cached(self, t: int) -> Optional[bytes]:
        return self.cache.get(int(t))

    async def _run_loop(self):
        loop = asyncio.get_running_loop()
        try:
            while not self._stopping:
                await self._wake.wait()
                self._wake.clear()

                if self.current_time is None:
                    # nothing to do until current_time is set
                    await asyncio.sleep(0.1)
                    continue

                target = self.current_time
                # determine which timesteps we need to prefetch
                needed = [t for t in range(target + 1, target + 1 + self.TARGET_BUFFER_SIZE) if t not in self.cache]
                if needed:
                    logger.info("BufferManager prefetching timesteps: %s", needed)

                # CRITICAL FIX: Fetch ONE timestep at a time to avoid flooding server
                # Old approach spawned all 15 tasks concurrently → 15+ concurrent requests → server overload
                for t in needed:
                    if self._stopping:
                        break
                    try:
                        # fetch in executor to avoid blocking the event loop
                        data = await loop.run_in_executor(None, self.dm.fetch_chunk, t, None, None, self.quality)
                        self.cache[t] = data
                        logger.info("Buffered timestep %s (bytes=%d)", t, len(data))
                    except asyncio.CancelledError:
                        logger.info("BufferManager fetch cancelled for timestep %s", t)
                        return
                    except Exception:
                        logger.exception("Failed to prefetch timestep %s", t)

                # simple eviction: keep only [current_time..current_time+TARGET_BUFFER_SIZE]
                keep = set(range(target, target + 1 + self.TARGET_BUFFER_SIZE))
                to_delete = [k for k in self.cache.keys() if k not in keep]
                for k in to_delete:
                    del self.cache[k]
                if to_delete:
                    logger.info("BufferManager evicted timesteps: %s", to_delete)

                    # small sleep to avoid tight loop; will be woken when set_current_time called
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            logger.info("BufferManager run loop cancelled")
        except Exception:
            logger.exception("Unhandled exception in BufferManager run loop")
        finally:
            logger.info("BufferManager exiting run loop")
