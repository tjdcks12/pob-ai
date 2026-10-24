import assert from 'node:assert/strict';
import { test } from 'node:test';
import { updatePresentation } from '../ui/updates.js';

test('update notifications distinguish availability, download progress, readiness and retry', () => {
  assert.equal(updatePresentation(null).visible, false);
  assert.equal(updatePresentation({ phase: 'checking' }).busy, true);
  const progress = updatePresentation({ phase: 'downloading', progress: { received: 25, total: 100 } });
  assert.equal(progress.vars.progress, '25%');
  assert.equal(progress.busy, true);
  const ready = updatePresentation({ phase: 'ready', latest: '0.2.7', available: false, restartNeeded: true });
  assert.equal(ready.visible, true, 'a prepared update remains visible even though it no longer needs downloading');
  assert.equal(ready.action, 'restartToUpdate');
  assert.equal(ready.busy, false);
  assert.equal(updatePresentation({ phase: 'error' }).action, 'retry');
  assert.equal(updatePresentation({ phase: 'checkError' }).visible, false, 'quiet checks do not show a blocking banner');
});
