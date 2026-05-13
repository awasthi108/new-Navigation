"""
============================================================================
telemetry.py — NavAI Telemetry Streaming Engine
============================================================================
PURPOSE:
    This file simulates a LIVE GNSS telemetry stream using historical data.
    Instead of receiving real-time satellite signals, we "replay" the dataset
    one step at a time, mimicking how a real ground station would receive
    data gradually.

HOW TELEMETRY STREAMING WORKS:
    1. On startup, we load the full cleaned dataset into memory
    2. We maintain a "cursor" (current_index) that tracks our position
    3. Every time the /telemetry API is called:
       a. We advance the cursor by 1 step
       b. We return the last 20 values (the window) as "recent telemetry"
       c. We predict the NEXT value using the trained model
       d. We compute RMSE and MAE for the current window
       e. We check if the latest value is an ANOMALY

ANOMALY DETECTION:
    An anomaly is detected when the actual residual error deviates
    significantly from the predicted value. Specifically:
    
        |actual - predicted| > threshold
    
    The threshold is set to 2× the standard deviation of the full series.
    This catches sudden spikes that could indicate satellite malfunctions,
    ionospheric disturbances, or multipath errors.

RESET:
    The /reset endpoint resets the cursor back to the beginning,
    allowing the telemetry stream to replay from the start.
============================================================================
"""

import numpy as np
from sklearn.metrics import mean_squared_error, mean_absolute_error
from typing import Dict, Any

from app.utils import (
    load_all_datasets,
    clean_data,
    get_residual_series,
    WINDOW_SIZE,
)
from app.model import predict_next_value


# ---------------------------------------------------------------------------
# TELEMETRY STATE (kept in memory)
# ---------------------------------------------------------------------------

class TelemetryStream:
    """
    Manages the state of the simulated telemetry stream.

    ATTRIBUTES:
        series      : The full residual error time-series (numpy array)
        current_idx : Current position in the stream (advances each call)
        threshold   : Anomaly detection threshold (2× std deviation)

    LIFECYCLE:
        1. initialize() — loads data, sets up the stream
        2. get_next()   — advances one step, returns telemetry + prediction
        3. reset()      — resets cursor to beginning
    """

    def __init__(self):
        self.series: np.ndarray = np.array([])
        self.current_idx: int = WINDOW_SIZE  # Start after first full window
        self.threshold: float = 0.0
        self._initialized: bool = False

    def initialize(self):
        """
        Load the dataset and prepare the telemetry stream.

        WHAT HAPPENS:
            1. Loads all CSV files
            2. Cleans the data
            3. Extracts the mean residual series
            4. Computes the anomaly threshold (2× standard deviation)
            5. Sets the starting cursor position

        This is called once on server startup.
        """
        if self._initialized:
            return

        print("[NavAI Telemetry] Initializing telemetry stream...")

        # Load and clean data
        df = load_all_datasets()
        df = clean_data(df)

        # Extract the combined residual error series
        self.series = get_residual_series(df)

        # Anomaly threshold: if a value deviates more than 2× the standard
        # deviation from the predicted value, it's flagged as anomalous.
        self.threshold = float(np.std(self.series) * 2.0)

        # Start the cursor just after the first complete window
        # (we need at least WINDOW_SIZE values to make a prediction)
        self.current_idx = WINDOW_SIZE

        self._initialized = True
        print(f"[NavAI Telemetry] Stream ready. {len(self.series)} data points.")
        print(f"[NavAI Telemetry] Anomaly threshold: ±{self.threshold:.4f} m")

    def get_next(self) -> Dict[str, Any]:
        """
        Advance the telemetry stream by one step and return current state.

        WHAT HAPPENS EACH CALL:
            1. Get the current window (last 20 values up to current_idx)
            2. Predict the next value using the Ridge model
            3. Compute RMSE and MAE for the window vs. a naive prediction
            4. Check if the latest actual value is anomalous
            5. Advance the cursor by 1

        RETURNS:
            Dictionary with:
            {
                "telemetry": [...],     # Last 20 residual values (list of floats)
                "prediction": float,    # Predicted next residual value
                "rmse": float,          # RMSE of recent predictions
                "mae": float,           # MAE of recent predictions
                "anomaly": bool,        # Whether current value is anomalous
                "current_index": int,   # Current position in the dataset
                "total_points": int,    # Total data points available
            }

        WRAPPING:
            When we reach the end of the dataset, the cursor wraps around
            to the beginning, creating an infinite replay loop.
        """
        if not self._initialized:
            self.initialize()

        # --- Wrap around if we've reached the end ---
        if self.current_idx >= len(self.series):
            self.current_idx = WINDOW_SIZE

        # --- Extract the current window (last WINDOW_SIZE values) ---
        start = self.current_idx - WINDOW_SIZE
        window = self.series[start:self.current_idx]

        # --- Make prediction for the next value ---
        prediction = predict_next_value(window)

        # --- Get the actual next value (if available) for error computation ---
        if self.current_idx < len(self.series):
            actual_current = self.series[self.current_idx]
        else:
            actual_current = self.series[WINDOW_SIZE]

        # --- Compute RMSE and MAE ---
        # We compare the model's predictions against actual values
        # over the recent window to give a running accuracy metric.
        # Here we compute a simple error between prediction and actual.
        error = abs(prediction - actual_current)
        rmse = float(np.sqrt(error ** 2))  # For single point, RMSE = |error|
        mae = float(error)

        # For a more meaningful RMSE/MAE, compute over a batch of recent predictions
        if self.current_idx > WINDOW_SIZE + 10:
            recent_actuals = []
            recent_preds = []
            # Look back at the last 10 predictions
            for i in range(max(WINDOW_SIZE, self.current_idx - 10), self.current_idx):
                w = self.series[i - WINDOW_SIZE:i]
                p = predict_next_value(w)
                a = self.series[i]
                recent_preds.append(p)
                recent_actuals.append(a)

            rmse = float(np.sqrt(mean_squared_error(recent_actuals, recent_preds)))
            mae = float(mean_absolute_error(recent_actuals, recent_preds))

        # --- Anomaly Detection ---
        # An anomaly occurs when the actual value deviates significantly
        # from what the model predicted. This could indicate:
        #   - Satellite clock drift
        #   - Ionospheric disturbance
        #   - Multipath interference
        #   - Hardware malfunction
        anomaly = bool(abs(actual_current - prediction) > self.threshold)

        # --- Advance the cursor for next call ---
        self.current_idx += 1

        # --- Build response ---
        return {
            "telemetry": window.tolist(),       # Last 20 values as a list
            "prediction": round(prediction, 6), # Predicted next value
            "rmse": round(rmse, 6),             # Root Mean Squared Error
            "mae": round(mae, 6),               # Mean Absolute Error
            "anomaly": anomaly,                 # True if spike detected
            "current_index": self.current_idx,  # Where we are in the stream
            "total_points": len(self.series),   # Total available data points
        }

    def reset(self):
        """
        Reset the telemetry stream back to the beginning.

        USE CASE:
            Called by the POST /reset endpoint to restart the replay
            from the first data point. Useful for demos or re-analysis.
        """
        self.current_idx = WINDOW_SIZE
        print("[NavAI Telemetry] Stream reset to beginning.")


# ---------------------------------------------------------------------------
# SINGLETON INSTANCE
# ---------------------------------------------------------------------------
# We use a single global instance so all API calls share the same state.
# This means the telemetry cursor advances consistently across requests.

telemetry_stream = TelemetryStream()
