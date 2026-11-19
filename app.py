import json
import os
import secrets
from datetime import date
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL")
DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "PomodoroLeaderboard")
DATA_FILE = os.path.join(DATA_DIR, "data.json")
DEFAULTS = {"Focus": 25, "Short Break": 5, "Long Break": 15}


def default_state():
    return {
        "users": [],
        "user_tokens": {},
        "sessions": [],
        "todos": {},
        "settings": dict(DEFAULTS)
    }


def get_db_conn():
    import psycopg2
    url = DATABASE_URL
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return psycopg2.connect(url)


def init_db():
    if not DATABASE_URL:
        return
    with get_db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS app_state (
                    id INTEGER PRIMARY KEY,
                    payload JSONB NOT NULL
                );
            """)
            cur.execute("SELECT payload FROM app_state WHERE id = 1;")
            if cur.fetchone() is None:
                cur.execute(
                    "INSERT INTO app_state (id, payload) VALUES (1, %s);",
                    (json.dumps(default_state()),)
                )
        conn.commit()


def normalize_data(raw):
    data = default_state()
    if isinstance(raw, dict):
        data.update(raw)
    for k, v in DEFAULTS.items():
        data["settings"].setdefault(k, v)
    if not isinstance(data.get("todos"), dict):
        data["todos"] = {}
    if not isinstance(data.get("user_tokens"), dict):
        data["user_tokens"] = {}
    return data


def public_state(data):
    """Strip secret user_tokens before sending state to browsers."""
    return {
        "users": data["users"],
        "sessions": data["sessions"],
        "todos": data["todos"],
        "settings": data["settings"]
    }


def load_data():
    if DATABASE_URL:
        try:
            init_db()
            with get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT payload FROM app_state WHERE id = 1;")
                    row = cur.fetchone()
                    if row:
                        payload = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                        return normalize_data(payload)
        except Exception as e:
            print("Database load error:", e)
            return default_state()

    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            return normalize_data(json.load(f))
    except (OSError, ValueError):
        return default_state()


def save_data(data):
    if DATABASE_URL:
        try:
            init_db()
            with get_db_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO app_state (id, payload)
                        VALUES (1, %s::jsonb)
                        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;
                        """,
                        (json.dumps(data),)
                    )
                conn.commit()
            return
        except Exception as e:
            print("Database save error:", e)

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def is_authorized(data, user, token):
    if not user or user not in data["users"]:
        return False
    saved_token = data["user_tokens"].get(user)
    if not saved_token:
        # Legacy user without token: claim it on first verified action
        if token:
            data["user_tokens"][user] = token
            save_data(data)
            return True
        return False
    return secrets.compare_digest(saved_token, token or "")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(public_state(load_data()))


@app.route("/api/users", methods=["POST"])
def add_user():
    data = load_data()
    req = request.json or {}
    name = req.get("name", "").strip()[:20]
    if not name:
        return jsonify({"error": "Name cannot be empty."}), 400

    if name.lower() in (u.lower() for u in data["users"]):
        return jsonify({"error": "That player name is already taken! Choose another."}), 409

    token = secrets.token_hex(16)
    data["users"].append(name)
    data["user_tokens"][name] = token
    data["todos"].setdefault(name, [])
    save_data(data)
    return jsonify({"state": public_state(data), "user": name, "token": token})


@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = load_data()
    req = request.json or {}
    data["settings"] = req.get("settings", data["settings"])
    save_data(data)
    return jsonify(public_state(data))


@app.route("/api/sessions", methods=["POST"])
def add_session():
    data = load_data()
    req = request.json or {}
    user = req.get("user")
    token = req.get("token", "")

    if not is_authorized(data, user, token):
        return jsonify({"error": "Unauthorized device for this player."}), 403

    try:
        minutes = max(0, min(120, int(req.get("minutes") or 0)))
        pomodoros = max(0, min(1, int(req.get("pomodoros") or 0)))
    except (TypeError, ValueError):
        minutes, pomodoros = 0, 0

    if minutes > 0 or pomodoros > 0:
        data["sessions"].append({
            "user": user,
            "date": date.today().isoformat(),
            "minutes": minutes,
            "pomodoros": pomodoros
        })
        save_data(data)
    return jsonify(public_state(data))


@app.route("/api/todos", methods=["POST"])
def save_todos():
    data = load_data()
    req = request.json or {}
    user = req.get("user")
    token = req.get("token", "")
    todos = req.get("todos", [])

    if not is_authorized(data, user, token):
        return jsonify({"error": "Unauthorized device for this player."}), 403

    if isinstance(todos, list):
        data["todos"][user] = todos
        save_data(data)
    return jsonify(public_state(data))

@app.route("/api/reset", methods=["GET", "POST"])
def reset_all_data():
    admin_key = os.environ.get("ADMIN_KEY", "reset123")
    provided_key = request.args.get("key") or (request.get_json(silent=True) or {}).get("key", "")
    if not secrets.compare_digest(admin_key, provided_key):
        return jsonify({"error": "Invalid admin key."}), 403

    fresh = default_state()
    save_data(fresh)
    return jsonify({"message": "All players, sessions, and to-dos have been reset!", "state": public_state(fresh)})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
