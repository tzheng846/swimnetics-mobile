// uploadRetry — is this upload failure worth retrying, and what do we tell the coach? (Phase 84-05).
//
// PURE by design: no imports at all. That is what lets scratch/upload_retry_check.mjs in the backend
// repo import() this file directly and assert on it — the mobile tree has no test runner, so a
// module with zero imports is the only kind that can be checked headlessly.
//
// Why it exists: videoUploadQueue used to turn every non-2xx into `Server error (413)` and then burn
// two more attempts (3 s + 10 s) on it. A 413 is deterministic — api.py rejects on size BEFORE any
// storage work — so those ~13 s bought an outcome that could not change, and the chip said only
// "Video upload failed" regardless. Phase 84 item 2 measured 9 sessions in the live library with
// video_origin_s set and video_path NULL: clips the phone had in hand that silently never landed.

// ⚠ THIRD COPY of this constant. The other two are:
//   • api.py:1219                            — AUTHORITATIVE (the server enforces it; 413s above it)
//   • web/components/portal/VideoPane.js:17  — the web annotate uploader's client-side guard
// No shared config crosses the backend/mobile repo boundary, so the value is duplicated rather than
// imported. scratch/upload_retry_check.mjs parses api.py and fails if this copy drifts from it.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB (Supabase free-tier ceiling)

const CAP_MB = MAX_VIDEO_BYTES / (1024 * 1024);

// Every message ends in what the coach can actually do. For a video that means naming Photos:
// RecordScreen's saveVideoToLibrary copies each recording there, so a failed upload costs the
// ATTACHMENT, not the footage — and the web annotate page can attach an external clip later.
const IN_PHOTOS = 'The video is still in your Photos.';

// Bytes → "Video is 78 MB — the limit is 50 MB. …". Used by the queue's pre-flight check, which
// knows the real size; classifyUploadFailure's 413 branch does not.
export function videoTooLargeMessage(bytes) {
  const mb = Math.round(Number(bytes) / (1024 * 1024));
  return `Video is ${mb} MB — the limit is ${CAP_MB} MB. Record a shorter clip. ${IN_PHOTOS}`;
}

// The local file went away before the queue reached the job (in-memory queue, disk cleanup, etc.).
export function videoMissingMessage() {
  return `The video file is no longer on this phone, so it can't be uploaded. Check Photos.`;
}

// { status, message } → { permanent, message }.
//
// permanent === true means retrying CANNOT change the outcome, so the queue parks the job at once
// and UploadToast hides its Retry button rather than offering a false affordance.
// `status` is the HTTP status when there is one; a network/offline failure has none.
export function classifyUploadFailure({ status, message } = {}) {
  if (status === 413) {
    return {
      permanent: true,
      message: `Video is over the ${CAP_MB} MB limit. Record a shorter clip. ${IN_PHOTOS}`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      permanent: true,
      message: `Your sign-in expired. Sign in again to upload videos. ${IN_PHOTOS}`,
    };
  }
  if (status === 404) {
    return {
      permanent: true,
      message: `That session no longer exists, so there's nothing to attach the video to. ${IN_PHOTOS}`,
    };
  }
  if (status === 422) {
    return {
      permanent: true,
      message: `The server couldn't accept this video file. ${IN_PHOTOS}`,
    };
  }
  if (status === 429) {
    return { permanent: false, message: 'The server is busy — trying again in a moment.' };
  }
  if (status != null && status >= 500) {
    return { permanent: false, message: `Server error (${status}) — trying again in a moment.` };
  }
  if (status != null && status >= 400) {
    // An unmapped 4xx. Treat as transient rather than parking a job on a status we haven't reasoned
    // about — a wasted retry is cheaper than a silently discarded clip, which is the bug being fixed.
    return { permanent: false, message: `The server rejected the upload (${status}) — trying again.` };
  }
  // No status at all: network / offline / timeout.
  const msg = message || '';
  if (/network|fetch|timeout|connection|offline|unreachable/i.test(msg)) {
    return { permanent: false, message: `You appear to be offline — trying again. ${IN_PHOTOS}` };
  }
  return {
    permanent: false,
    message: msg ? `Upload failed: ${msg}. ${IN_PHOTOS}` : `Upload failed. ${IN_PHOTOS}`,
  };
}
