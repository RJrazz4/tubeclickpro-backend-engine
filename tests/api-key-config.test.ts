import { afterEach, describe, expect, it } from 'vitest';
import { getConfig, resetConfigForTests } from '../src/config/env.js';

const originalYouTube = process.env.YOUTUBE_API_KEY;
const originalEleven = process.env.ELEVENLABS_API_KEY;

afterEach(() => {
  if (originalYouTube === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = originalYouTube;
  if (originalEleven === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalEleven;
  resetConfigForTests();
});

describe('comma-separated provider key configuration', () => {
  it('trims, removes blanks, and de-duplicates YouTube and ElevenLabs keys', () => {
    process.env.NODE_ENV = 'test';
    process.env.AUTH_MODE = 'development';
    process.env.YOUTUBE_API_KEY = ' yt-one, yt-two, ,yt-one ';
    process.env.ELEVENLABS_API_KEY = ' el-one ,el-two,el-three ';
    resetConfigForTests();

    const config = getConfig();
    expect(config.YOUTUBE_API_KEY).toEqual(['yt-one', 'yt-two']);
    expect(config.ELEVENLABS_API_KEY).toEqual(['el-one', 'el-two', 'el-three']);
  });
});
