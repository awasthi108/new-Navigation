"""
============================================================================
train.py — NavAI Model Training Pipeline
============================================================================
PURPOSE:
    This file handles the complete ML training pipeline:
      1. Load and clean the GNSS satellite datasets
      2. Create sliding window features from the time-series
      3. Normalize features using MinMaxScaler
      4. Split data into training and testing sets
      5. Train a Ridge Regression model
      6. Evaluate with RMSE and MAE metrics
      7. Save the trained model and scaler to disk

HOW RIDGE REGRESSION WORKS FOR TIME-SERIES:
    Ridge Regression is a linear model with L2 regularization.
    It finds the best linear combination of the 20 past values
    that predicts the next value:

        prediction = w1*val_t-20 + w2*val_t-19 + ... + w20*val_t-1 + bias

    The L2 penalty prevents overfitting by keeping weights small,
    which is important when features (past values) are correlated
    (as they often are in time-series data).

WHEN DOES TRAINING RUN:
    - Automatically on first server startup if model files don't exist
    - Manually by running: python -m app.train
============================================================================
"""

import os
import numpy as np
import joblib
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error

from app.utils import (
    load_all_datasets,
    clean_data,
    get_residual_series,
    create_sliding_windows,
    WINDOW_SIZE,
)


# ---------------------------------------------------------------------------
# PATHS — Where to save the trained model and scaler
# ---------------------------------------------------------------------------

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODELS_DIR, "ridge_model.pkl")
SCALER_PATH = os.path.join(MODELS_DIR, "scaler.pkl")


# ---------------------------------------------------------------------------
# TRAINING FUNCTION
# ---------------------------------------------------------------------------

def train_model() -> dict:
    """
    Complete training pipeline for the NavAI Ridge Regression model.

    STEPS:
        1. Load all CSV datasets from app/data/
        2. Clean data (remove NaN, invalid rows)
        3. Extract the mean residual error time-series
        4. Normalize the series to [0, 1] range using MinMaxScaler
        5. Create sliding window features (20 past → 1 future)
        6. Split into 80% train / 20% test
        7. Train Ridge Regression (alpha=1.0 for regularization)
        8. Compute RMSE and MAE on the test set
        9. Save model and scaler as .pkl files

    RETURNS:
        Dictionary with training metrics:
        {
            "rmse": float,      # Root Mean Squared Error on test set
            "mae": float,       # Mean Absolute Error on test set
            "train_size": int,  # Number of training samples
            "test_size": int,   # Number of test samples
        }
    """
    print("=" * 60)
    print("  NavAI — Training Ridge Regression Model")
    print("=" * 60)

    # --- Step 1: Load datasets ---
    print("\n[Step 1] Loading datasets...")
    df = load_all_datasets()

    # --- Step 2: Clean data ---
    print("\n[Step 2] Cleaning data...")
    df = clean_data(df)

    # --- Step 3: Extract residual series ---
    print("\n[Step 3] Extracting residual error time-series...")
    series = get_residual_series(df)
    print(f"  Series length: {len(series)} data points")
    print(f"  Series range: [{series.min():.4f}, {series.max():.4f}]")

    # --- Step 4: Normalize using MinMaxScaler ---
    # MinMaxScaler transforms values to [0, 1] range.
    # This helps the model train faster and prevents large values
    # from dominating the prediction.
    print("\n[Step 4] Normalizing data with MinMaxScaler...")
    scaler = MinMaxScaler(feature_range=(0, 1))
    # Reshape to 2D for sklearn (requires column vector)
    series_scaled = scaler.fit_transform(series.reshape(-1, 1)).flatten()

    # --- Step 5: Create sliding windows ---
    print(f"\n[Step 5] Creating sliding windows (size={WINDOW_SIZE})...")
    X, y = create_sliding_windows(series_scaled, window_size=WINDOW_SIZE)
    print(f"  Features shape: {X.shape}  (samples × window_size)")
    print(f"  Targets shape:  {y.shape}")

    # --- Step 6: Train/Test split ---
    # We use 80% for training and 20% for testing.
    # shuffle=False because this is time-series data — we don't want
    # future data leaking into the training set.
    print("\n[Step 6] Splitting into train/test (80/20)...")
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False
    )
    print(f"  Train samples: {len(X_train)}")
    print(f"  Test samples:  {len(X_test)}")

    # --- Step 7: Train Ridge Regression ---
    # alpha=1.0 is the regularization strength.
    # Higher alpha = more regularization = simpler model (less overfitting)
    print("\n[Step 7] Training Ridge Regression (alpha=1.0)...")
    model = Ridge(alpha=1.0)
    model.fit(X_train, y_train)
    print("  ✓ Model trained successfully")

    # --- Step 8: Evaluate on test set ---
    print("\n[Step 8] Evaluating on test set...")
    y_pred = model.predict(X_test)

    # RMSE: Root Mean Squared Error — penalizes large errors more
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    # MAE: Mean Absolute Error — average magnitude of errors
    mae = float(mean_absolute_error(y_test, y_pred))

    print(f"  RMSE: {rmse:.6f}")
    print(f"  MAE:  {mae:.6f}")

    # --- Step 9: Save model and scaler ---
    print(f"\n[Step 9] Saving model to {MODEL_PATH}...")
    os.makedirs(MODELS_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)
    print("  ✓ Model saved: ridge_model.pkl")
    print("  ✓ Scaler saved: scaler.pkl")

    print("\n" + "=" * 60)
    print("  Training Complete!")
    print("=" * 60)

    return {
        "rmse": rmse,
        "mae": mae,
        "train_size": len(X_train),
        "test_size": len(X_test),
    }


# ---------------------------------------------------------------------------
# ENTRY POINT — Run training directly with: python -m app.train
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    metrics = train_model()
    print(f"\nFinal Metrics: {metrics}")
