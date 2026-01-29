# ---- FRONTEND ----
FROM node:20 AS frontend
WORKDIR /app
COPY gpt-chat/package*.json ./
RUN npm ci
COPY gpt-chat .
RUN npm run build

# ---- BACKEND ----
FROM python:3.11-slim
WORKDIR /app

# Install deps
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy backend + built frontend
COPY . .
COPY --from=frontend /app/build ./build

ENV HOST=0.0.0.0
ENV PORT=8080
CMD ["python", "launcher.py"]
