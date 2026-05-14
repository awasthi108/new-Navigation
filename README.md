# NavAI – GNSS Satellite Intelligence Platform

NavAI is a full-stack aerospace-inspired telemetry dashboard that visualizes GNSS satellite residual behavior and predicts future drift patterns using machine learning.

The project combines:

* real GNSS datasets
* Ridge Regression forecasting
* live telemetry replay
* interactive orbital visualization
* real-time dashboard monitoring

---
## 🌐 Live Demo

# Frontend:
https://new-nav-detect.vercel.app/

# Backend API:
https://navai-backend.onrender.com/

API Docs:
https://navai-backend.onrender.com/docs

## 🚀 Features

* 3D Earth and satellite visualization
* Live telemetry streaming
* Residual prediction forecasting
* RMSE and MAE monitoring
* Anomaly detection simulation
* AI insights dashboard
* Mission-control style UI

---

## 🧠 Machine Learning

The backend uses a Ridge Regression model trained on GNSS residual telemetry.

Residuals are computed using:

Residual = Broadcast Value − Precise Value

A sliding window approach is used to predict future residual values from historical telemetry.

---

## 🛠️ Tech Stack

### Frontend

* Next.js
* TypeScript
* Tailwind CSS
* React Three Fiber
* Recharts

### Backend

* FastAPI
* Python
* Scikit-learn
* Pandas
* NumPy

---

## 🌐 Architecture

Frontend (Next.js)
↓
FastAPI Backend
↓
ML Prediction Runtime
↓
GNSS Dataset Replay Engine

---

## ▶️ Running Locally

### Frontend

```bash
npm install
npm run dev
```

### Backend

```bash
pip install -r requirements.txt
python -m app.train
python -m uvicorn app.main:app --reload
```

---

## 📡 Deployment

* Frontend hosted on Vercel
* Backend hosted on Render

---

## 👨‍💻 Author

Shushant Kumar Awasthi

Rudhra Pratap Singh

Final Year Capstone Project
