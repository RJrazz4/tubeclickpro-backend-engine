import { describe, expect, it } from 'vitest';
import { executeRequestSchema } from '../src/domain/job.js';

describe('execute request validation', () => {
  it.each([
    'https://youtube.com/watch?v=abc',
    'https://www.youtube.com/shorts/abc',
    'https://youtu.be/abc',
  ])('accepts an HTTPS YouTube URL: %s', (videoUrl) => {
    expect(executeRequestSchema.parse({ videoUrl }).videoUrl).toBe(videoUrl);
  });

  it.each([
    'http://youtube.com/watch?v=abc',
    'https://evil.example/watch?v=abc',
    'file:///etc/passwd',
  ])('rejects unsafe or non-YouTube input: %s', (videoUrl) => {
    expect(() => executeRequestSchema.parse({ videoUrl })).toThrow();
  });
});
