import json
import os
from datetime import date
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "PomodoroLeaderboard")
DATA_FILE = os.path.join(DATA_DIR, "data.json")
DEFAULTS = {"Focus": 25, "Short Break": 5, "Long Break": 15}


def load_data():
    data = {
        "users": [],
        "sessions": [],
        "todos": {},
        "settings": dict(DEFAULTS),
        "last_user": ""
    }
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data.update(json.load(f))
    except (OSError, ValueError):
        pass
    for k, v in DEFAULTS.items():
        data["settings"].setdefault(k, v)
    if not isinstance(data.get("todos"), dict):
        data["todos"] = {}
    return data


def save_data(data):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(load_data())


@app.route("/api/users", methods=["POST"])
def add_user():
    data = load_data()
    req = request.json or {}
    name = req.get("name", "").strip()[:20]
    if name and name.lower() not in (u.lower() for u in data["users"]):
        data["users"].append(name)
        data["last_user"] = name
        data["todos"].setdefault(name, [])
        save_data(data)
    return jsonify(data)


@app.route("/api/last-user", methods=["POST"])
def set_last_user():
    data = load_data()
    req = request.json or {}
    user = req.get("user", "")
    if user == "" or user in data["users"]:
        data["last_user"] = user
        save_data(data)
    return jsonify(data)


@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = load_data()
    req = request.json or {}
    data["settings"] = req.get("settings", data["settings"])
    save_data(data)
    return jsonify(data)


@app.route("/api/sessions", methods=["POST"])
def add_session():
    data = load_data()
    req = request.json or {}
    user = req.get("user")
    try:
        minutes = max(0, int(req.get("minutes") or 0))
        pomodoros = max(0, int(req.get("pomodoros") or 0))
    except (TypeError, ValueError):
        minutes, pomodoros = 0, 0

    if user in data["users"] and (minutes > 0 or pomodoros > 0):
        data["sessions"].append({
            "user": user,
            "date": date.today().isoformat(),
            "minutes": minutes,
            "pomodoros": pomodoros
        })
        save_data(data)
    return jsonify(data)


@app.route("/api/todos", methods=["POST"])
def save_todos():
    data = load_data()
    req = request.json or {}
    user = req.get("user") or "_default"
    todos = req.get("todos", [])
    if isinstance(todos, list):
        data["todos"][user] = todos
        save_data(data)
    return jsonify(data)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)