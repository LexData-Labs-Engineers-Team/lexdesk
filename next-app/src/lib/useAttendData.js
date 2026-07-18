'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from './apiFetch';

// Fetches org-wide AttendDesk data through the (admin-gated) /api/attenddesk
// proxy. Pass the resources a page needs, e.g. useAttendData(['employees','attendance']).
// Pass { month: { y, m } } (m 0-11) to scope the attendance fetch to one month
// instead of pulling the latest 1000 events org-wide.
const RESOURCE_QUERY = {
  employees: 'resource=employees',
  attendance: 'resource=attendance&limit=1000',
  leaveRequests: 'resource=leaveRequests',
  policy: 'resource=policy',
  office: 'resource=office',
};

// ISO range covering an office-tz month, widened ±1 day so the Asia/Dhaka
// offset never clips edge days (callers filter to the exact month client-side).
function attendanceQuery(monthKey) {
  if (!monthKey) return RESOURCE_QUERY.attendance;
  const [y, m] = monthKey.split('-').map(Number);
  const from = new Date(Date.UTC(y, m, 1));
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(Date.UTC(y, m + 1, 1));
  to.setUTCDate(to.getUTCDate() + 1);
  return `resource=attendance&limit=1000&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

export function useAttendData(resources = ['employees', 'attendance'], opts = {}) {
  const month = opts.month || null;
  const monthKey = month ? `${month.y}-${month.m}` : '';
  const key = `${resources.join(',')}|${monthKey}`;

  const [state, setState] = useState({
    employees: [],
    events: [],
    leave: [],
    loading: true,
    error: '',
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const token = localStorage.getItem('token');
      const [listStr, mk] = key.split('|');
      const list = listStr.split(',').filter(Boolean);
      const results = await Promise.all(
        list.map(async (r) => {
          const q = r === 'attendance' ? attendanceQuery(mk) : (RESOURCE_QUERY[r] || `resource=${r}`);
          const res = await apiFetch(`/api/attenddesk?${q}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
          return [r, json];
        }),
      );
      const next = { employees: [], events: [], leave: [], loading: false, error: '' };
      for (const [r, json] of results) {
        if (r === 'employees') next.employees = json.employees || [];
        else if (r === 'attendance') next.events = json.events || [];
        else if (r === 'leaveRequests') next.leave = json.requests || [];
      }
      setState(next);
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }));
    }
  }, [key]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}
