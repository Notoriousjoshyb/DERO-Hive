import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';

vi.mock('../src/main/utils/paths', async () => {
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  return { paths: { attachments: join(tmpdir(), 'dero-hive-attachment-tests') } };
});

import { paths } from '../src/main/utils/paths';
import { hydrateAttachmentRefs, serializedAttachmentIds, storeAttachment, validateAttachmentRefs } from '../src/main/utils/attachments';

describe('stored attachments', () => {
  beforeEach(async () => {
    await rm(paths.attachments, { recursive: true, force: true });
    await mkdir(paths.attachments, { recursive: true });
  });

  afterAll(async () => {
    await rm(paths.attachments, { recursive: true, force: true });
  });

  it('persists references without base64 and hydrates them for providers', async () => {
    const id = await storeAttachment(Buffer.from('image-bytes'));
    const content = JSON.stringify([{ type: 'attachment_ref', attachment: {
      id, type: 'image', filename: 'proof.png', mimeType: 'image/png', size: 11
    } }]);

    expect(serializedAttachmentIds(content)).toEqual([id]);
    expect(content).not.toContain(Buffer.from('image-bytes').toString('base64'));

    const [message] = await hydrateAttachmentRefs([{ id: 'm1', role: 'user', content: JSON.parse(content), createdAt: 1 }]);
    expect(message.content).toEqual([{
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}` }
    }]);
    await expect(validateAttachmentRefs(JSON.parse(content), 10, 100)).rejects.toThrow('per-file');
  });
});
