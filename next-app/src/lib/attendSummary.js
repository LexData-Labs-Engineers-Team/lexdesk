// Shared attendance-summary helpers for the mobile manager views
// (api/v1/me/team-summary and api/v1/manage/attendance). All times are computed
// in Asia/Dhaka (no DST, fixed +06:00 offset).

// YYYY-MM-DD in Asia/Dhaka.
export function dhakaDay(iso) {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

// HH:mm (24h) in Asia/Dhaka.
export function dhakaHhmm(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

// The Dhaka date keys for today + the previous 6 days (7 total), today first.
export function lastSevenDays(nowMs) {
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dhakaDay(new Date(nowMs - i * 86_400_000).toISOString()));
  return days;
}

// One person's last-7-day attendance summary + today's in/out. `events` are that
// person's attendanceEvents; canon per day = earliest passing CHECK_IN, latest
// passing CHECK_OUT.
export function memberSummary(events, last7, today) {
  const byDay = {};
  for (const e of events) {
    if (!e.allChecksPassed || !e.timestamp) continue;
    const day = dhakaDay(e.timestamp);
    const slot = (byDay[day] ||= { in: null, out: null, late: false });
    if (e.type === 'CHECK_IN') {
      if (!slot.in || e.timestamp < slot.in.timestamp) { slot.in = e; slot.late = !!e.isLate; }
    } else if (e.type === 'CHECK_OUT') {
      if (!slot.out || e.timestamp > slot.out.timestamp) slot.out = e;
    }
  }
  let onTime = 0, late = 0, absent = 0;
  for (const day of last7) {
    const slot = byDay[day];
    if (!slot || !slot.in) absent++;
    else if (slot.late) late++;
    else onTime++;
  }
  const todaySlot = byDay[today];
  return {
    onTime,
    late,
    absent,
    todayIn: todaySlot?.in ? dhakaHhmm(todaySlot.in.timestamp) : null,
    todayOut: todaySlot?.out ? dhakaHhmm(todaySlot.out.timestamp) : null,
  };
}

// Index attendance events by their owner's uid.
export function indexEventsByUid(events) {
  const byUid = {};
  for (const e of events) {
    const id = String(e.user?.id ?? '');
    (byUid[id] ||= []).push(e);
  }
  return byUid;
}
