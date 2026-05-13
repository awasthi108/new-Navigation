"""
============================================================================
utils.py — NavAI Utility Functions
============================================================================
PURPOSE:
    This file contains reusable helper functions used across the NavAI backend.
    It handles:
      - Loading and combining CSV datasets
      - Cleaning and validating data (missing values, invalid rows)
      - Detecting residual error columns automatically
      - Creating sliding window features for time-series forecasting

HOW SLIDING WINDOW WORKS:
    GNSS satellite errors change over time. To predict the NEXT error value,
    we look at the LAST N values (window). For example, with window_size=20:
    
    Input:  [val_1, val_2, ..., val_20]  →  Predict: val_21
    
    This converts a 1D time-series into a supervised learning problem where
    each row has 20 features (past values) and 1 target (next value).
============================================================================
"""

import os
import pandas as pd
import numpy as np
from typing import Tuple, List


# ---------------------------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------------------------

# Path to the data folder (relative to this file's location)
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# The number of past observations used to predict the next value.
# A window of 20 means: use the last 20 residual error readings to forecast
# the 21st reading. This is a common choice for short-term time-series.
WINDOW_SIZE = 20

# Column names we expect in the CSV files (residual errors in meters)
EXPECTED_COLUMNS = ["x_error (m)", "y_error (m)", "z_error (m)", "satclockerror (m)"]


# ---------------------------------------------------------------------------
# DATA LOADING
# ---------------------------------------------------------------------------

def load_all_datasets() -> pd.DataFrame:
    """
    Load all CSV datasets from the /data folder and combine them into one
    single DataFrame.

    WHAT IT DOES:
        1. Scans the data/ directory for all .csv files
        2. Reads each CSV file into a pandas DataFrame
        3. Concatenates (stacks) all DataFrames vertically
        4. Resets the index so rows are numbered 0, 1, 2, ...

    RETURNS:
        A single pandas DataFrame containing all satellite error data
        from GEO and MEO satellites combined.
    """
    all_frames: List[pd.DataFrame] = []

    # Walk through every file in the data directory
    for filename in sorted(os.listdir(DATA_DIR)):
        if filename.endswith(".csv"):
            filepath = os.path.join(DATA_DIR, filename)
            print(f"[NavAI] Loading dataset: {filename}")
            df = pd.read_csv(filepath)
            all_frames.append(df)

    if not all_frames:
        raise FileNotFoundError(
            f"No CSV files found in {DATA_DIR}. "
            "Please place your datasets in the app/data/ folder."
        )

    # Stack all datasets vertically into one big DataFrame
    combined = pd.concat(all_frames, ignore_index=True)
    print(f"[NavAI] Combined dataset shape: {combined.shape}")
    return combined


# ---------------------------------------------------------------------------
# DATA CLEANING
# ---------------------------------------------------------------------------

def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Clean the raw dataset by handling missing values and invalid rows.

    WHAT IT DOES:
        1. Normalizes column names (strips whitespace, collapses double spaces)
        2. Merges duplicate columns caused by inconsistent naming across CSVs
        3. Identifies the numeric residual error columns
        4. Converts any non-numeric values to NaN (handles corrupted data)
        5. Drops rows where ANY residual column has a missing/NaN value
        6. Resets the index

    WHY:
        Real GNSS data can have gaps (satellite outages), corrupted readings,
        or placeholder values. We need clean, continuous data for the ML model.
        Different CSV files may also have slightly different column naming
        (e.g., "y_error  (m)" vs "y_error (m)") which we handle here.

    RETURNS:
        Cleaned DataFrame with only valid numeric rows.
    """
    # Normalize column names: strip whitespace and collapse multiple spaces
    # This fixes issues like "y_error  (m)" vs "y_error (m)"
    import re
    df.columns = [re.sub(r'\s+', ' ', col.strip()) for col in df.columns]

    # Handle duplicate columns that may arise from merging CSVs with
    # slightly different naming. For example, after normalization we might
    # have two "y_error (m)" columns. We merge them by taking the first
    # non-null value (coalesce).
    if df.columns.duplicated().any():
        # Group duplicate columns and combine them
        cols_seen = {}
        for idx, col in enumerate(df.columns):
            if col in cols_seen:
                # Merge: fill NaN in the first occurrence with values from duplicate
                first_idx = cols_seen[col]
                df.iloc[:, first_idx] = df.iloc[:, first_idx].fillna(df.iloc[:, idx])
            else:
                cols_seen[col] = idx
        # Keep only the first occurrence of each column
        df = df.loc[:, ~df.columns.duplicated(keep='first')]

    # Detect which residual columns are present
    residual_cols = detect_residual_columns(df)
    print(f"[NavAI] Detected residual columns: {residual_cols}")

    # Force numeric conversion — any non-numeric cell becomes NaN
    df = df.copy()  # Avoid SettingWithCopyWarning
    for col in residual_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Count missing values before dropping
    missing_count = df[residual_cols].isna().sum().sum()
    if missing_count > 0:
        print(f"[NavAI] Dropping {missing_count} missing/invalid values")

    # Drop rows with any NaN in residual columns
    df = df.dropna(subset=residual_cols).reset_index(drop=True)

    print(f"[NavAI] Cleaned dataset shape: {df.shape}")
    return df


def detect_residual_columns(df: pd.DataFrame) -> List[str]:
    """
    Automatically detect which columns contain residual error data.

    LOGIC:
        The CSV files already contain pre-computed residual errors
        (broadcast - precise). We look for columns matching known patterns
        like 'x_error', 'y_error', 'z_error', 'satclockerror'.

    NOTE:
        In a full system, you might have separate broadcast and precise
        columns and compute: residual = broadcast - precise.
        Here, the datasets already provide the residual directly.

    RETURNS:
        List of column names that contain residual error values.
    """
    residual_cols = []
    for col in df.columns:
        col_lower = col.lower().strip()
        # Match columns that contain error data
        if any(keyword in col_lower for keyword in ["x_error", "y_error", "z_error", "satclockerror"]):
            residual_cols.append(col)

    if not residual_cols:
        raise ValueError(
            "Could not detect residual error columns in the dataset. "
            f"Available columns: {list(df.columns)}"
        )

    return residual_cols


# ---------------------------------------------------------------------------
# SLIDING WINDOW FEATURE ENGINEERING
# ---------------------------------------------------------------------------

def create_sliding_windows(data: np.ndarray, window_size: int = WINDOW_SIZE) -> Tuple[np.ndarray, np.ndarray]:
    """
    Convert a 1D time-series array into sliding window features + targets.

    HOW IT WORKS (EXAMPLE with window_size=3):
        Input series: [10, 20, 30, 40, 50, 60]

        Window 1: features=[10, 20, 30] → target=40
        Window 2: features=[20, 30, 40] → target=50
        Window 3: features=[30, 40, 50] → target=60

    FOR OUR CASE (window_size=20):
        Each row of X has 20 past residual values.
        Each value in y is the NEXT residual value to predict.

    PARAMETERS:
        data        : 1D numpy array of residual error values over time
        window_size : how many past values to use as features (default: 20)

    RETURNS:
        X : 2D array of shape (n_samples, window_size) — the features
        y : 1D array of shape (n_samples,) — the targets (next values)
    """
    X, y = [], []

    for i in range(len(data) - window_size):
        # The feature window: last `window_size` values
        window = data[i : i + window_size]
        # The target: the very next value after the window
        target = data[i + window_size]
        X.append(window)
        y.append(target)

    return np.array(X), np.array(y)


def get_residual_series(df: pd.DataFrame) -> np.ndarray:
    """
    Extract a single combined residual error series from the DataFrame.

    WHAT IT DOES:
        Takes the mean of all residual columns at each time step to create
        a single "overall residual error" time-series. This simplifies the
        prediction task to one output value.

    WHY MEAN:
        Instead of building 4 separate models (one per axis + clock),
        we combine them into a single representative signal. This is
        suitable for anomaly detection and general health monitoring.

    RETURNS:
        1D numpy array of mean residual errors over time.
    """
    residual_cols = detect_residual_columns(df)
    # Compute row-wise mean across all residual columns
    series = df[residual_cols].mean(axis=1).values
    return series
