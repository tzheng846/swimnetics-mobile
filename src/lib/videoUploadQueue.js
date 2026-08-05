// videoUploadQueue — app-wide background video uploads (Phase 47-03).
//
// Module singleton (no React): RecordScreen enqueues a job and forgets; jobs upload
// FIFO one-at-a-time via FileSystem.uploadAsync so the transfer survives the screen
// unmounting, and (sessionType BACKGROUND, iOS) the app being backgrounded. Failures
// auto-retry twice with backoff, then park as 'failed' for the UploadToast chip.
// In-memory only — jobs do not survive an app restart (the video file stays on disk).
import * as FileSystem from 'expo-file-system/legacy';
import { API_BASE } from '../config';
import { supabase } from './supabase';

const RETRY_DELAYS_MS = [3000, 10000]; // after 1st and 2nd failure
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const DONE_PRUNE_MS = 6000; // keep 'done' jobs long enough for the toast

let jobs = [];
let nextId = 1;
let working = false;
const listeners = new Set();

function snapshot() {
  return jobs.map(j => ({ ...j }));
}

function notify() {
  const snap = snapshot();
  listeners.forEach(l => {
    try { l(snap); } catch {}
  });
}

// listener(jobsSnapshot) — called immediately with the current state, then on every change.
export function subscribe(listener) {
  listeners.add(listener);
  try { listener(snapshot()); } catch {}
  return () => listeners.delete(listener);
}

export function enqueue({ sessionId, uri, label }) {
  if (!sessionId || !uri) return null;
  const job = {
    id: nextId++,
    sessionId,
    uri,
    label: label || 'Session video',
    status: 'queued', // queued | uploading | done | failed
    attempts: 0,
    lastError: null,
  };
  jobs.push(job);
  notify();
  pump();
  return job.id;
}

// Re-queue a job that exhausted its retries (chip Retry button).
export function retryJob(jobId) {
  const job = jobs.find(j => j.id === jobId);
  if (!job || job.status !== 'failed') return;
  job.status = 'queued';
  job.attempts = 0;
  job.lastError = null;
  notify();
  pump();
}

// Drop a failed job (chip ✕). Active uploads can't be dismissed.
export function dismissJob(jobId) {
  jobs = jobs.filter(j => j.id !== jobId || j.status === 'uploading');
  notify();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function uploadOnce(job) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Not signed in');
  // expo-camera records .mov (QuickTime); the backend stores it as {session_id}.mp4
  // (path name only — content-type is preserved).
  const res = await FileSystem.uploadAsync(
    `${API_BASE}/sessions/${job.sessionId}/video`,
    job.uri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: 'video/quicktime',
      headers: { Authorization: `Bearer ${token}` },
      // iOS: hand the transfer to an NSURLSession background session so it
      // continues while the app is backgrounded mid-upload.
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    },
  );
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Server error (${res.status})`);
  }
}

// Single-flight worker: drains the queue one job at a time. Never throws.
async function pump() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const job = jobs.find(j => j.status === 'queued');
      if (!job) break;
      job.status = 'uploading';
      notify();
      try {
        job.attempts += 1;
        await uploadOnce(job);
        job.status = 'done';
        notify();
        setTimeout(() => {
          jobs = jobs.filter(j => j !== job);
          notify();
        }, DONE_PRUNE_MS);
      } catch (e) {
        job.lastError = e?.message || 'Upload failed';
        if (job.attempts < MAX_ATTEMPTS) {
          job.status = 'queued'; // retry — stays at the front (FIFO by array order)
          notify();
          await sleep(RETRY_DELAYS_MS[job.attempts - 1]);
        } else {
          job.status = 'failed'; // parked for the chip
          notify();
        }
      }
    }
  } finally {
    working = false;
    // A job enqueued while we were finishing the last one restarts the worker.
    if (jobs.some(j => j.status === 'queued')) pump();
  }
}
