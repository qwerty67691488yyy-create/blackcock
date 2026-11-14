
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = "https://chlrxpfoyficauowjtqb.supabase.co";
const SUPABASE_KEY = "sb_publishable_jbwYjqP6rH0S0s8SGx9RMA_gLQa6kAp";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function App() {
  const [session, setSession] = useState(null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;

    async function init() {
      const { data: { session } } = await supabase.auth.getSession();

      if (!alive) return;

      if (session) {
        setSession(session);
      } else {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) setError(error.message);
        else if (alive) setSession(data.session);
      }
    }

    init();

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => setSession(session)
    );

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function loadPlayers(roomId) {
    const { data, error } = await supabase
      .from("blackjack_players")
      .select("id,nickname,seat")
      .eq("room_id", roomId)
      .order("seat");

    if (error) {
      setError(error.message);
      return;
    }

    setPlayers(data || []);
  }

  useEffect(() => {
    if (!room?.id) return;

    loadPlayers(room.id);

    const channel = supabase
      .channel("room-" + room.id)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "blackjack_players",
          filter: "room_id=eq." + room.id
        },
        () => loadPlayers(room.id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room?.id]);

  async function createRoom() {
    setBusy(true);
    setError("");
    setMessage("");

    const name = nickname.trim();
    if (!name) {
      setError("Введи своё имя");
      setBusy(false);
      return;
    }

    const { data, error } = await supabase.rpc(
      "create_blackjack_room",
      { p_nickname: name }
    );

    if (error) {
      setError(error.message);
    } else {
      const result = data?.[0];
      if (!result) {
        setError("Сервер не вернул комнату");
      } else {
        setRoom({ id: result.room_id, code: result.room_code });
        setMessage("Комната создана!");
      }
    }

    setBusy(false);
  }

  async function joinRoom() {
    setBusy(true);
    setError("");
    setMessage("");

    const name = nickname.trim();
    const code = roomCode.trim().toUpperCase();

    if (!name || !code) {
      setError("Введи имя и код комнаты");
      setBusy(false);
      return;
    }

    const { data, error } = await supabase.rpc(
      "join_blackjack_room",
      { p_code: code, p_nickname: name }
    );

    if (error) {
      setError(error.message);
    } else {
      setRoom({ id: data, code });
      setMessage("Ты вошёл в комнату!");
    }

    setBusy(false);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code);
      setMessage("Код скопирован!");
    } catch {
      setMessage("Код комнаты: " + room.code);
    }
  }

  async function leaveRoom() {
    setRoom(null);
    setPlayers([]);
    setMessage("Ты вышел из комнаты. Участник пока останется в списке.");
  }

  if (!session) {
    return (
      <main className="page">
        <section className="panel">
          <div className="logo">♠</div>
          <h1>BLACKJACK</h1>
          <p>Подключаемся к игровому столу...</p>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="panel">
        <div className="logo">♠</div>
        <p className="eyebrow">PREMIUM CASINO</p>
        <h1>BLACKJACK</h1>
        <p className="subtitle">Онлайн-игра с друзьями</p>

        {!room ? (
          <>
            <label>Твоё имя</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Например, Алекс"
              maxLength={20}
            />

            <button disabled={busy} onClick={createRoom}>
              {busy ? "Подождите..." : "Создать комнату"}
            </button>

            <div className="separator">ИЛИ ВОЙТИ ПО КОДУ</div>

            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="КОД КОМНАТЫ"
              maxLength={6}
            />

            <button className="secondary" disabled={busy} onClick={joinRoom}>
              Войти в комнату
            </button>
          </>
        ) : (
          <>
            <div className="room-code">
              <span>КОД КОМНАТЫ</span>
              <strong>{room.code}</strong>
              <button className="secondary" onClick={copyCode}>
                Скопировать код
              </button>
            </div>

            <h2>Игроки за столом ({players.length}/6)</h2>

            <div className="players">
              {players.map((player) => (
                <div className="player" key={player.id}>
                  <span className="seat">{player.seat}</span>
                  <span>{player.nickname}</span>
                  {player.seat === 1 && <span className="host">ХОЗЯИН</span>}
                </div>
              ))}
            </div>

            <p className="waiting">Ожидаем игроков...</p>
            <button className="secondary" onClick={leaveRoom}>
              Покинуть комнату
            </button>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {message && <p className="message">{message}</p>}

        <p className="footer">ВИРТУАЛЬНЫЕ ФИШКИ · БЕЗ РЕАЛЬНЫХ ДЕНЕГ</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
