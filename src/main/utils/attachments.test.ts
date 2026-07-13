import { describe, it } from 'node:test';
import assert from 'node:assert';
import { attachmentIds, serializedAttachmentIds } from './attachments';
import type { ContentPart } from '@shared/types';

describe('attachments', () => {
  // attachmentIds — empty/non-array
  it('returns [] for string content', () => {
    assert.deepEqual(attachmentIds('hello'), []);
  });

  it('returns [] for empty array', () => {
    assert.deepEqual(attachmentIds([]), []);
  });

  // attachmentIds — extracts ids from attachment_ref parts
  it('extracts attachment ids', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'hello' },
      { type: 'attachment_ref', attachment: { id: 'abc', type: 'image', filename: 'x.png', mimeType: 'image/png', size: 100 } },
      { type: 'text', text: 'world' }
    ];
    assert.deepEqual(attachmentIds(parts), ['abc']);
  });

  it('extracts multiple ids in order', () => {
    const parts: ContentPart[] = [
      { type: 'attachment_ref', attachment: { id: 'id1', type: 'file', filename: 'a.txt', mimeType: 'text/plain', size: 10 } },
      { type: 'attachment_ref', attachment: { id: 'id2', type: 'audio', filename: 'b.mp3', mimeType: 'audio/mpeg', size: 10 } }
    ];
    assert.deepEqual(attachmentIds(parts), ['id1', 'id2']);
  });

  it('ignores text and other part types', () => {
    const parts: ContentPart[] = [
      { type: 'image_url', image_url: { url: 'http://x.com/img.png' } },
      { type: 'text', text: 'hello' }
    ];
    assert.deepEqual(attachmentIds(parts), []);
  });

  // serializedAttachmentIds
  it('parses and extracts from JSON string', () => {
    const json = JSON.stringify([
      { type: 'text', text: 'hello' },
      { type: 'attachment_ref', attachment: { id: 'uuid-123', type: 'image', data: '', filename: 'x.png', mimeType: 'image/png', size: 100 } }
    ]);
    assert.deepEqual(serializedAttachmentIds(json), ['uuid-123']);
  });

  it('returns [] for invalid JSON', () => {
    assert.deepEqual(serializedAttachmentIds('not json'), []);
  });

  it('returns [] for valid JSON but no attachment_ref', () => {
    assert.deepEqual(serializedAttachmentIds('{"type":"text","text":"hi"}'), []);
  });
});
