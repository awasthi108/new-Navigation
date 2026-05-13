"""
============================================================================
model.py — NavAI Model Loading & Prediction
============================================================================
PURPOSE:
    This file handles:
      - Loading the trained Ridge Regression model from disk
      - Loading the MinMaxScaler from disk
      - Making predictions given a window of past residual values
      - Auto-training if model files don't exist yet

HOW PREDICTION WORKS:
    1. Take the last 20 residual error values (the "window")
    2. Normalize them using the saved MinMaxScaler
    3. Feed the normalized window into the Ridge model
    4. The model outputs a normalized prediction
    5. Inverse-transform to get the prediction in original units (meters)

    This gives us the PREDICTED next residual error value, which we can
    compare against the ACTUAL value to detect anomalies.
============================================================================
"""

import os
import numpy as np
import joblib
from typing import Optional

from app.utils import WINDOW_SIZE


# ---------------------------------------------------------------------------
# PATHS
# ---------------------------------------------------------------------------

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODELS_DIR, "ridge_model.pkl")
SCALER_PATH = os.path.join(MODELS_DIR, "scaler.pkl")


# ---------------------------------------------------------------------------
# GLOBAL MODEL CACHE
# ---------------------------------------------------------------------------
# We load the model once and keep it in memory for fast predictions.
# This avoids reading from disk on every API call.

_model = None
_scaler = None


# ---------------------------------------------------------------------------
# MODEL LOADING
# ---------------------------------------------------------------------------

def load_model():
    """
    Load the trained Ridge model and MinMaxScaler from disk into memory.

    BEHAVIOR:
        - If model files exist → load them
        - If model files DON'T exist → automatically trigger training first
        - Caches the model globally so subsequent calls are instant

    WHY GLOBAL CACHE:
        Loading from disk takes time. Since the model doesn't change during
        runtime, we load it once and reuse it for all predictions.
    """
    global _model, _scaler

    # Check if model files exist; if not, train first
    if not os.path.exists(MODEL_PATH) or not os.path.exists(SCALER_PATH):
        print("[NavAI] Model not found. Training automatically...")
        from app.train import train_model
        train_model()

    # Load the trained model and scaler from .pkl files
    _model = joblib.load(MODEL_PATH)
    _scaler = joblib.load(SCALER_PATH)
    print("[NavAI] Model and scaler loaded successfully.")


def get_model():
    """
    Get the cached model instance. Loads from disk if not yet loaded.

    RETURNS:
        The trained Ridge Regression model (sklearn Ridge object)
    """
    global _model
    if _model is None:
        load_model()
    return _model


def get_scaler():
    """
    Get the cached scaler instance. Loads from disk if not yet loaded.

    RETURNS:
        The fitted MinMaxScaler object
    """
    global _scaler
    if _scaler is None:
        load_model()
    return _scaler


# ---------------------------------------------------------------------------
# PREDICTION
# ---------------------------------------------------------------------------

def predict_next_value(window: np.ndarray) -> float:
    """
    Predict the next residual error value given a window of past values.

    HOW IT WORKS:
        1. Takes raw residual values (in meters)
        2. Normalizes them to [0,1] using the saved scaler
        3. Reshapes to (1, window_size) for sklearn
        4. Model predicts the next normalized value
        5. Inverse-transforms back to meters

    PARAMETERS:
        window : numpy array of shape (WINDOW_SIZE,) containing the last
                 20 residual error values in their original scale (meters)

    RETURNS:
        float — the predicted next residual error value in meters

    EXAMPLE:
        window = np.array([0.5, 0.3, -0.1, ...])  # 20 values
        next_val = predict_next_value(window)
        # next_val ≈ 0.2 (predicted residual in meters)
    """
    model = get_model()
    scaler = get_scaler()

    # Step 1: Normalize the input window
    # Scaler expects 2D input: reshape from (20,) to (20, 1)
    window_scaled = scaler.transform(window.reshape(-1, 1)).flatten()

    # Step 2: Reshape for prediction: (1, 20) — one sample, 20 features
    X_input = window_scaled.reshape(1, -1)

    # Step 3: Predict (output is normalized)
    prediction_scaled = model.predict(X_input)[0]

    # Step 4: Inverse transform to get back to original scale (meters)
    # Scaler expects 2D: reshape scalar to (1, 1)
    prediction_original = scaler.inverse_transform(
        np.array([[prediction_scaled]])
    )[0, 0]

    return float(prediction_original)
