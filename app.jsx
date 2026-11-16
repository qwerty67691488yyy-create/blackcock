import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import "./styles.css";

const SUPABASE_URL = "https://chlrxpfoyficauowjtqb.supabase.co";
const SUPABASE_KEY = "sb_publishable_jbwYjqP6rH0S0s8SGx9RMA_gLQa6kAp";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function PlayingCard({ card, small = false }) {
  if (!card || card.hidden) {
    return <div className={`playing-card card-back ${small ? "small" : ""}`}>♠</div>;
  }
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className={`playing-card ${red ? "red-card" : ""} ${small ? "small" : ""}`}>
      <span>{card.rank}</span>
      <strong>{card.suit}</strong>
    </div>
  );
}

function App() {
  const [session, setSession] = useState(null);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [bet, setBet] = useState("100");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refreshGame = useCallback(async (roomId) => {
    if (!roomId) return;
    const { data, error: rpcError } = await supabase.rpc("blackjack_get_state", {
      p_room_id: roomId,
    });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setGame(data);
    setPlayers(data?.players || []);
  }, []);

  const restoreRoom = useCallback(async (userId) => {
    const { data: membership, error: memberError } = await supabase
      .from("blackjack_players")
      .select("room_id,nickname")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (memberError || !membership) return;

    const { data: roomData, error: roomError } = await supabase
      .from("blackjack_rooms")
      .select("id,code,owner_id,status")
      .eq("id", membership.room_id)
      .maybeSingle();
    if (roomError || !roomData) return;

    setNickname(membership.nickname || "");
    setRoom(roomData);
  }, []);

  useEffect(() => {
    let alive = true;
    async function init() {
      const { data: { session: existing } } = await supabase.auth.getSession();
      if (!alive) return;
      if (existing) {
        setSession(existing);
        await restoreRoom(existing.user.id);
      } else {
        const { data, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) setError(authError.message);
        else if (alive && data.session) setSession(data.session);
      }
    }
    init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [restoreRoom]);

  useEffect(() => {
    if (!room?.id) return;
    refreshGame(room.id);
    const channel = supabase
      .channel(`blackjack-room-${room.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "blackjack_players", filter: `room_id=eq.${room.id}`,
      }, () => refreshGame(room.id))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "blackjack_rooms", filter: `id=eq.${room.id}`,
      }, async () => {
        const { data } = await supabase.from("blackjack_rooms")
          .select("id,code,owner_id,status").eq("id", room.id).maybeSingle();
        if (data) setRoom(data);
        refreshGame(room.id);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room?.id, refreshGame]);

  async function createRoom() {
    setBusy(true); setError(""); setMessage("");
    const name = nickname.trim();
    if (!name) { setError("Введи своё имя"); setBusy(false); return; }
    const { data, error: rpcError } = await supabase.rpc("create_blackjack_room", { p_nickname: name });
    if (rpcError) setError(rpcError.message);
    else {
      const result = data?.[0];
      if (!result) setError("Сервер не вернул комнату");
      else {
        const nextRoom = { id: result.room_id, code: result.room_code, owner_id: session.user.id, status: "waiting" };
        setRoom(nextRoom);
        setMessage("Комната создана! Отправь код друзьям.");
      }
    }
    setBusy(false);
  }

  async function joinRoom() {
    setBusy(true); setError(""); setMessage("");
    const name = nickname.trim();
    const code = roomCode.trim().toUpperCase();
    if (!name || !code) { setError("Введи имя и код комнаты"); setBusy(false); return; }
    const { data, error: rpcError } = await supabase.rpc("join_blackjack_room", { p_code: code, p_nickname: name });
    if (rpcError) setError(rpcError.message);
    else {
      const { data: roomData, error: roomError } = await supabase.from("blackjack_rooms")
        .select("id,code,owner_id,status").eq("id", data).single();
      if (roomError) setError(roomError.message);
      else { setRoom(roomData); setMessage("Ты вошёл в комнату!"); }
    }
    setBusy(false);
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(room.code); setMessage("Код скопирован!"); }
    catch { setMessage("Код комнаты: " + room.code); }
  }

  async function placeBet() {
    setBusy(true); setError(""); setMessage("");
    const amount = Number(bet);
    const { error: rpcError } = await supabase.rpc("blackjack_place_bet", { p_room_id: room.id, p_bet: amount });
    if (rpcError) setError(rpcError.message);
    else { setMessage("Ставка принята"); await refreshGame(room.id); }
    setBusy(false);
  }

  async function startRound() {
    setBusy(true); setError(""); setMessage("");
    const { error: rpcError } = await supabase.rpc("blackjack_start_round", { p_room_id: room.id });
    if (rpcError) setError(rpcError.message);
    else { setMessage("Раунд начался!"); await refreshGame(room.id); }
    setBusy(false);
  }

  async function playerAction(action) {
    setBusy(true); setError(""); setMessage("");
    const { error: rpcError } = await supabase.rpc("blackjack_player_action", {
      p_room_id: room.id, p_action: action,
    });
    if (rpcError) setError(rpcError.message);
    else await refreshGame(room.id);
    setBusy(false);
  }

  async function leaveRoom() {
    setBusy(true); setError("");
    const { error: rpcError } = await supabase.rpc("blackjack_leave_room", { p_room_id: room.id });
    if (rpcError) setError(rpcError.message);
    else { setRoom(null); setGame(null); setPlayers([]); setMessage("Ты покинул комнату"); }
    setBusy(false);
  }

  if (!session) {
    return <main className="page"><section className="panel">
      <div className="logo">♠</div><h1>BLACKJACK</h1><p>Подключаемся к игровому столу...</p>
      {error && <p className="error">{error}</p>}
    </section></main>;
  }

  const me = players.find((player) => player.is_me);
  const myTurn = game?.phase === "playing" && me?.seat === game.current_turn;
  const dealerCards = game?.dealer_hand || [];
  const dealerScore = game?.dealer_score;
  let myResult = "";
  if (game?.phase === "finished" && me) {
    const dealerNatural = dealerCards.length === 2 && dealerScore === 21;
    if (me.natural_blackjack && dealerNatural) myResult = "НИЧЬЯ · БЛЭКДЖЕК У ОБОИХ";
    else if (me.natural_blackjack) myResult = "БЛЭКДЖЕК · ВЫИГРЫШ 3:2";
    else if (me.busted || dealerNatural) myResult = "ПОРАЖЕНИЕ";
    else if (dealerScore > 21 || me.score > dealerScore) myResult = "ПОБЕДА";
    else if (me.score === dealerScore) myResult = "НИЧЬЯ";
    else myResult = "ПОРАЖЕНИЕ";
  }

  return (
    <main className="page">
      <section className={`panel ${room ? "table-panel" : ""}`}>
        <div className="logo">♠</div>
        <p className="eyebrow">PREMIUM CASINO</p>
        <h1>BLACKJACK</h1>
        <p className="subtitle">Онлайн-игра с друзьями</p>

        {!room ? <>
          <label>Твоё имя</label>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Например, Алекс" maxLength={20} />
          <button disabled={busy} onClick={createRoom}>{busy ? "Подождите..." : "Создать комнату"}</button>
          <div className="separator">ИЛИ ВОЙТИ ПО КОДУ</div>
          <input value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="КОД КОМНАТЫ" maxLength={6} />
          <button className="secondary" disabled={busy} onClick={joinRoom}>Войти в комнату</button>
        </> : <>
          <div className="room-code">
            <span>КОД КОМНАТЫ</span><strong>{room.code}</strong>
            <button className="secondary" onClick={copyCode}>Скопировать код</button>
          </div>

          <div className="table-status">
            {game?.phase === "playing" ? "РАУНД ИДЁТ" : game?.phase === "finished" ? "РАУНД ЗАВЕРШЁН" : "ОЖИДАНИЕ СТАВОК"}
            {game?.round_no > 0 && <span> · РАУНД {game.round_no}</span>}
          </div>

          <div className="casino-table">
            <div className="dealer-area">
              <div className="hand-heading">ДИЛЕР {game?.phase === "finished" && dealerScore != null ? `· ${dealerScore}` : dealerCards.length ? `· ${dealerScore}+` : ""}</div>
              <div className="cards-row">
                {dealerCards.map((card, index) => <PlayingCard key={`dealer-${index}`} card={card} />)}
              </div>
            </div>
            <div className="table-divider" />
            <div className="players-area">
              {players.map((player) => (
                <div className={`game-player ${player.is_me ? "current-player" : ""} ${game?.current_turn === player.seat ? "active-turn" : ""}`} key={player.id}>
                  <div className="game-player-top">
                    <span className="player-name">{player.nickname}{player.is_me ? " (ты)" : ""}</span>
                    <span className="player-money">{player.balance} фишек</span>
                  </div>
                  <div className="cards-row compact-cards">
                    {player.hand?.length ? player.hand.map((card, index) => <PlayingCard key={`${player.id}-${index}`} card={card} small />)
                      : <span className="no-cards">Карты ещё не розданы</span>}
                  </div>
                  <div className="player-meta">
                    <span>Ставка: {player.bet || 0}</span>
                    {player.score != null && <span>Очки: {player.score}</span>}
                    {player.busted && <b className="result-bad">ПЕРЕБОР</b>}
                    {player.natural_blackjack && <b className="result-good">BLACKJACK</b>}
                    {player.stood && !player.busted && game?.phase === "playing" && <b>СТОИТ</b>}
                    {game?.current_turn === player.seat && game?.phase === "playing" && <b className="turn-label">ХОД</b>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {game?.phase === "betting" && <div className="game-controls">
            <p className="control-hint">Выбери ставку. Для раунда нужны ставки минимум двух игроков; остальные могут пропустить раздачу. Начать может любой участник.</p>
            <div className="bet-row">
              <input type="number" min="10" max="1000" step="10" value={bet} onChange={(e) => setBet(e.target.value)} aria-label="Размер ставки" />
              <button disabled={busy || !bet} onClick={placeBet}>Поставить</button>
            </div>
            <button disabled={busy || players.filter((p) => p.bet > 0).length < 2} onClick={startRound}>Начать раунд</button>
            {players.length < 2 && <p className="waiting">Для начала игры нужен ещё хотя бы один игрок.</p>}
          </div>}

          {game?.phase === "playing" && <div className="game-controls">
            {myTurn ? <>
              <p className="your-turn">Твой ход</p>
              <div className="action-row">
                <button disabled={busy} onClick={() => playerAction("hit")}>Ещё карту</button>
                <button className="secondary" disabled={busy} onClick={() => playerAction("stand")}>Хватит</button>
              </div>
            </> : <p className="waiting">{me?.stood || me?.busted ? "Ты завершил ход. Ожидаем остальных..." : `Сейчас ход игрока: ${players.find((p) => p.seat === game.current_turn)?.nickname || "..."}`}</p>}
          </div>}

          {game?.phase === "finished" && <div className="game-controls">
            <p className="round-finished">{myResult} · Раунд завершён</p>
            <p className="control-hint">Сделай ставку, чтобы перейти к следующему раунду. Когда поставят минимум два игрока, можно начинать раздачу.</p>
            <div className="bet-row">
              <input type="number" min="10" max="1000" step="10" value={bet} onChange={(e) => setBet(e.target.value)} aria-label="Размер ставки на следующий раунд" />
              <button disabled={busy || !bet} onClick={placeBet}>Поставить</button>
            </div>
          </div>}

          <button className="secondary leave-button" disabled={busy || game?.phase === "playing"} onClick={leaveRoom}>Покинуть комнату</button>
        </>}

        {error && <p className="error">{error}</p>}
        {message && <p className="message">{message}</p>}
        <p className="footer">ВИРТУАЛЬНЫЕ ФИШКИ · БЕЗ РЕАЛЬНЫХ ДЕНЕГ</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
