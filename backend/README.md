# 🛰️ NavAI — GNSS Satellite Prediction Platform (Backend)

A machine learning backend that predicts GNSS satellite residual errors using Ridge Regression, simulates live telemetry streaming, and detects anomalies in real-time.

---

## 📁 Project Structure

```
backend/
├── app/
│   ├── __init__.py        # Package marker
│   ├── main.py            # FastAPI application & endpoints
│   ├── model.py           # Model loading & prediction logic
│   ├── telemetry.py       # Telemetry streaming engine
│   ├── train.py           # ML training pipeline
│   ├── utils.py           # Data loading & utility functions
│   ├── models/
│   │   ├── ridge_model.pkl   # Trained Ridge Regression model (auto-generated)
│   │   └── scaler.pkl        # Fitted MinMaxScaler (auto-generated)
│   └── data/
│       ├── DATA_GEO_Train(1).csv
│       ├── DATA_MEO_Train(1).csv
│       └── DATA_MEO_Train2(1).csv
└── requirements.txt
```

---

## 🚀 Run Instructions (Step by Step)

### 1. Open Terminal and Navigate to Backend Folder

```bash
cd "e:\tryy\p1 capstone\navai-dashboard\backend"
```

### 2. Create a Virtual Environment

```bash
python -m venv venv
```

### 3. Activate the Virtual Environment

**Windows (CMD):**
```bash
venv\Scripts\activate
```

**Windows (PowerShell):**
```bash
.\venv\Scripts\Activate.ps1
```

### 4. Install Dependencies

```bash
pip install -r requirements.txt
```

### 5. Train the Model (Optional — auto-trains on first server start)

```bash
python -m app.train
```

This will:
- Load all CSV datasets
- Clean and preprocess the data
- Train a Ridge Regression model
- Save `ridge_model.pkl` and `scaler.pkl` to `app/models/`

### 6. Run the FastAPI Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The server will be available at: **http://localhost:8000**

---

## 📡 API Endpoints

### `GET /`
Health check endpoint.

**Response:**
```json
{
  "message": "NavAI GNSS Prediction Platform is running",
  "status": "healthy",
  "version": "1.0.0"
}
```

### `GET /telemetry`
Returns current telemetry window, prediction, metrics, and anomaly status.

**Response:**
```json
{
  "telemetry": [0.5, 0.3, -0.1, ...],
  "prediction": 0.25,
  "rmse": 0.012,
  "mae": 0.008,
  "anomaly": false,
  "current_index": 42,
  "total_points": 1500
}
```

### `POST /reset`
Resets the telemetry stream to the beginning.

**Response:**
```json
{
  "message": "Telemetry stream reset successfully",
  "current_index": 20,
  "status": "reset_complete"
}
```

---

## 🧠 How It Works

1. **Data Loading**: Combines GEO and MEO satellite error datasets
2. **Residual Computation**: The CSVs contain pre-computed residuals (broadcast - precise)
3. **Sliding Window**: Uses last 20 values to predict the next value
4. **Ridge Regression**: Linear model with L2 regularization for time-series forecasting
5. **Telemetry Streaming**: Replays historical data one step at a time
6. **Anomaly Detection**: Flags values that deviate > 2σ from predictions

---

## 📊 Interactive API Docs

Once the server is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
