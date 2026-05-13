"""
============================================================================
main.py — NavAI FastAPI Application Entry Point
============================================================================
PURPOSE:
    This is the main file that creates and configures the FastAPI web server.
    It defines the API endpoints that the frontend (or any client) can call
    to interact with the NavAI GNSS prediction system.

ENDPOINTS:
    GET  /           → Health check / welcome message
    GET  /telemetry  → Get current telemetry data + prediction + anomaly status
    POST /reset      → Reset the telemetry stream to the beginning

HOW THE SERVER WORKS:
    1. On startup, it loads the ML model (training if needed)
    2. It initializes the telemetry stream with historical data
    3. Each GET /telemetry call advances the stream by one step
    4. The frontend can poll this endpoint to simulate live data

CORS:
    Cross-Origin Resource Sharing is enabled so that a frontend running
    on a different port (e.g., React on localhost:3000) can call this API
    (running on localhost:8000) without browser security blocking it.
============================================================================
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.model import load_model
from app.telemetry import telemetry_stream


# ---------------------------------------------------------------------------
# APPLICATION LIFESPAN (Startup & Shutdown Events)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manages what happens when the server starts up and shuts down.

    ON STARTUP:
        1. Load the trained Ridge model (auto-trains if not found)
        2. Initialize the telemetry stream (loads and cleans data)

    ON SHUTDOWN:
        (cleanup if needed — currently nothing to clean up)
    """
    # --- STARTUP ---
    print("\n" + "=" * 60)
    print("  🛰️  NavAI GNSS Prediction Platform — Starting Up")
    print("=" * 60 + "\n")

    # Load the ML model (will auto-train if model files don't exist)
    load_model()

    # Initialize the telemetry stream (loads dataset into memory)
    telemetry_stream.initialize()

    print("\n" + "=" * 60)
    print("  ✓ NavAI is ready! Server accepting requests.")
    print("=" * 60 + "\n")

    yield  # Server is running and handling requests

    # --- SHUTDOWN ---
    print("\n[NavAI] Server shutting down. Goodbye! 🛰️")


# ---------------------------------------------------------------------------
# CREATE FASTAPI APPLICATION
# ---------------------------------------------------------------------------

app = FastAPI(
    title="NavAI — GNSS Satellite Prediction Platform",
    description=(
        "A machine learning backend that predicts GNSS satellite residual "
        "errors using Ridge Regression. It simulates live telemetry streaming "
        "by replaying historical satellite data and detecting anomalies."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# CORS MIDDLEWARE
# ---------------------------------------------------------------------------
# This allows the frontend (running on a different origin/port) to make
# requests to this API. Without CORS, browsers block cross-origin requests.

app.add_middleware(
    CORSMiddleware,
    # Allow requests from any origin (for development).
    # In production, replace "*" with your frontend's actual URL.
    allow_origins=["*"],
    allow_credentials=True,
    # Allow all HTTP methods (GET, POST, PUT, DELETE, etc.)
    allow_methods=["*"],
    # Allow all headers
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API ENDPOINTS
# ---------------------------------------------------------------------------

@app.get("/", tags=["Health"])
async def root():
    """
    Health check endpoint.

    USE: Verify the server is running.
    RETURNS: A simple welcome message with system status.
    """
    return {
        "message": "NavAI GNSS Prediction Platform is running",
        "status": "healthy",
        "version": "1.0.0",
    }


@app.get("/telemetry", tags=["Telemetry"])
async def get_telemetry():
    """
    Get the current telemetry data, prediction, and anomaly status.

    HOW IT WORKS:
        1. Advances the telemetry stream by one time step
        2. Returns the last 20 residual values (the window)
        3. Returns the model's prediction for the next value
        4. Returns RMSE and MAE accuracy metrics
        5. Returns whether the current value is anomalous

    RESPONSE FORMAT:
        {
            "telemetry": [0.5, 0.3, -0.1, ...],  // Last 20 values (meters)
            "prediction": 0.25,                    // Predicted next value
            "rmse": 0.012,                         // Root Mean Squared Error
            "mae": 0.008,                          // Mean Absolute Error
            "anomaly": false,                      // Anomaly detected?
            "current_index": 42,                   // Position in dataset
            "total_points": 1500                   // Total data points
        }

    USAGE:
        The frontend should poll this endpoint at regular intervals
        (e.g., every 1-2 seconds) to simulate live telemetry updates.
    """
    try:
        result = telemetry_stream.get_next()
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Telemetry error: {str(e)}"
        )


@app.post("/reset", tags=["Telemetry"])
async def reset_telemetry():
    """
    Reset the telemetry stream back to the beginning.

    USE CASE:
        - Restart the demo/replay from the first data point
        - Useful for presentations or re-analysis
        - Frontend can call this when user clicks a "Reset" button

    RETURNS:
        Confirmation message with reset status.
    """
    try:
        telemetry_stream.reset()
        return {
            "message": "Telemetry stream reset successfully",
            "current_index": telemetry_stream.current_idx,
            "status": "reset_complete",
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Reset error: {str(e)}"
        )


# ---------------------------------------------------------------------------
# DIRECT EXECUTION
# ---------------------------------------------------------------------------
# This allows running the server directly with: python -m app.main
# But the recommended way is: uvicorn app.main:app --reload

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
