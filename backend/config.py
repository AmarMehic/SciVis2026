# backend/config.py
# Per-face DATA_SOURCES discovered by crawler
DATA_SOURCES = {
    "u": [
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_U/u_face_0_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_U/u_face_1_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_U/u_face_2_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_U/u_face_3_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_U/u_face_4_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_U/u_face_5_depth_52_time_0_10269.idx",
    ],
    "v": [
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_V/v_face_0_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_V/v_face_1_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_V/v_face_2_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_V/v_face_3_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_V/v_face_4_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_V/v_face_5_depth_52_time_0_10269.idx",
    ],
    "w": [
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_W/w_face_0_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_W/w_face_1_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_W/w_face_2_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_W/w_face_3_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_W/w_face_4_depth_52_time_0_10269.idx",
        "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS/GEOS_W/w_face_5_depth_52_time_0_10269.idx",
    ],
}

# Higher-level dataset config for MultiFaceDataManager
BASE_URL = "https://nsdf-climate3-origin.nationalresearchplatform.org:50098/nasa/nsdf/climate3/dyamond/GEOS"

def _get_face_url(var: str, face: int):
    return f"{BASE_URL}/GEOS_{var.upper()}/{var}_face_{face}_depth_52_time_0_10269.idx"

DATASET_CONFIG = {
    "base_url": BASE_URL,
    "faces": 6,
    "timesteps": [0],
    "variables": ["u", "v", "w"],
    "get_url": _get_face_url,
}
