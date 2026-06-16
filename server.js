const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const db = new sqlite3.Database("database.db");
const JWT_SECRET = "supersecret";

// --- CORS НАСТРОЙКА ДЛЯ VERCEL ---
app.use(cors({
    origin: "https://camp-frontend-nine.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

// --- JSON парсер ---
app.use(bodyParser.json());

// --- ОБЯЗАТЕЛЬНО: маршрут корня ---
app.get("/", (req, res) => {
    res.send("Backend is running");
});
function authRequired(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "No token" });

    const token = auth.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(401).json({ error: "Invalid token" });
        req.user = user;
        next();
    });
}

// Логин
app.post("/login", (req, res) => {
    const { login, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE login = ? AND password_hash = ?",
        [login, password],
        (err, user) => {
            if (err) return res.status(500).json({ error: "DB error" });
            if (!user) return res.status(401).json({ error: "Неверный логин или пароль" });

            const token = jwt.sign(
                { id: user.id, role: user.role, name: user.name },
                JWT_SECRET,
                { expiresIn: "7d" }
            );

            res.json({ token });
        }
    );
});

// ===== УЧАСТНИКИ =====

// список
app.get("/users", authRequired, (req, res) => {
    db.all(
        `SELECT u.*,
                t.name AS team_name,
                r.number AS room_number
         FROM users u
         LEFT JOIN teams t ON u.team_id = t.id
         LEFT JOIN rooms r ON u.room_id = r.id
         ORDER BY u.id`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json(rows);
        }
    );
});

// один
app.get("/users/:id", authRequired, (req, res) => {
    const id = req.params.id;
    db.get(
        `SELECT u.*,
                t.name AS team_name,
                r.number AS room_number
         FROM users u
         LEFT JOIN teams t ON u.team_id = t.id
         LEFT JOIN rooms r ON u.room_id = r.id
         WHERE u.id = ?`,
        [id],
        (err, row) => {
            if (err) return res.status(500).json({ error: "DB error" });
            if (!row) return res.status(404).json({ error: "User not found" });
            res.json(row);
        }
    );
});

// создание (админ)
app.post("/users", authRequired, (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
    }

    const { name, login, password, role, team_id, room_id } = req.body;

    if (!name || !login || !password || !role) {
        return res.status(400).json({ error: "Missing fields" });
    }

    const finalRole = ["admin", "leader", "child"].includes(role) ? role : "child";
    const teamId = finalRole === "child" ? team_id || null : null;
    const roomId = finalRole === "child" ? room_id || null : null;

    db.run(
        "INSERT INTO users (name, login, password_hash, role, team_id, room_id, coins) VALUES (?, ?, ?, ?, ?, ?, 0)",
        [name, login, password, finalRole, teamId, roomId],
        function (err) {
            if (err) {
                if (err.message.includes("UNIQUE")) {
                    return res.status(400).json({ error: "Логин уже занят" });
                }
                return res.status(500).json({ error: "DB error" });
            }
            res.json({ success: true, id: this.lastID });
        }
    );
});

// обновление команды/комнаты
app.post("/users/:id/update", authRequired, (req, res) => {
    const id = req.params.id;
    const { team_id, room_id } = req.body;

    db.run(
        "UPDATE users SET team_id = ?, room_id = ? WHERE id = ?",
        [team_id, room_id, id],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        }
    );
});

// монеты +/-
app.post("/users/:id/add", authRequired, (req, res) => {
    const id = req.params.id;
    const { amount } = req.body;

    db.run(
        "UPDATE users SET coins = coins + ? WHERE id = ?",
        [amount, id],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        }
    );
});

app.post("/users/:id/remove", authRequired, (req, res) => {
    const id = req.params.id;
    const { amount } = req.body;

    db.run(
        "UPDATE users SET coins = CASE WHEN coins - ? < 0 THEN 0 ELSE coins - ? END WHERE id = ?",
        [amount, amount, id],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        }
    );
});

// удаление
app.delete("/users/:id", authRequired, (req, res) => {
    const id = req.params.id;

    db.run("DELETE FROM users WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: "DB error" });
        if (this.changes === 0)
            return res.status(404).json({ error: "User not found" });
        res.json({ success: true });
    });
});

// ===== КОМАНДЫ =====

// список
app.get("/teams", authRequired, (req, res) => {
    db.all(
        `SELECT 
            t.id,
            t.name,
            COALESCE((SELECT SUM(coins) FROM users WHERE team_id = t.id), 0) AS total_coins
         FROM teams t
         ORDER BY t.id`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json(rows);
        }
    );
});

// создание
app.post("/teams", authRequired, (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
    }

    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Missing name" });

    db.run(
        "INSERT INTO teams (name) VALUES (?)",
        [name],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// монеты команде
app.post("/teams/:id/add", authRequired, (req, res) => {
    const id = req.params.id;
    const { amount } = req.body;

    db.run(
        "UPDATE users SET coins = coins + ? WHERE team_id = ?",
        [amount, id],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        }
    );
});

app.post("/teams/:id/remove", authRequired, (req, res) => {
    const id = req.params.id;
    const { amount } = req.body;

    db.run(
        "UPDATE users SET coins = CASE WHEN coins - ? < 0 THEN 0 ELSE coins - ? END WHERE team_id = ?",
        [amount, amount, id],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        }
    );
});

// удаление команды
app.delete("/teams/:id", authRequired, (req, res) => {
    const id = req.params.id;

    db.run("DELETE FROM teams WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: "DB error" });
        res.json({ success: true });
    });
});

// ===== КОМНАТЫ =====

// список
app.get("/rooms", authRequired, (req, res) => {
    db.all(
        `SELECT 
            id,
            number,
            cleanliness_rating
         FROM rooms
         ORDER BY id`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json(rows);
        }
    );
});

// создание
app.post("/rooms", authRequired, (req, res) => {
    if (req.user.role !== "admin") {
        return res.status(403).json({ error: "Forbidden" });
    }

    const { number } = req.body;
    if (!number) return res.status(400).json({ error: "Missing number" });

    db.run(
        "INSERT INTO rooms (number, cleanliness_rating) VALUES (?, 0)",
        [number],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// оценка
app.post("/rooms/:id/rate", authRequired, (req, res) => {
    const id = req.params.id;
    const { rating } = req.body;

    db.run(
        "UPDATE rooms SET cleanliness_rating = ? WHERE id = ?",
        [rating, id],
        function (err) {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json({ success: true });
        }
    );
});

// удаление комнаты
app.delete("/rooms/:id", authRequired, (req, res) => {
    const id = req.params.id;

    db.run("DELETE FROM rooms WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: "DB error" });
        res.json({ success: true });
    });
});

// ===== ТАБЛИЦА ЛИДЕРОВ =====

app.get("/leaderboard/users", authRequired, (req, res) => {
    db.all(
        `SELECT u.id, u.name, u.coins
         FROM users u
         WHERE u.role = 'child'
         ORDER BY u.coins DESC, u.id ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: "DB error" });
            res.json(rows);
        }
    );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
