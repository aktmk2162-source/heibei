import { describe, it, expect } from 'vitest';
import { createAudio } from '../src/audio/synth';

describe('synth (node environment guards)', () => {
  it('createAudio() does not throw', () => {
    expect(() => {
      createAudio();
    }).not.toThrow();
  });

  describe('AudioController methods', () => {
    it('unlock() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.unlock();
      }).not.toThrow();
    });

    it('startBgm() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.startBgm();
      }).not.toThrow();
    });

    it('stopBgm() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.stopBgm();
      }).not.toThrow();
    });

    it('setUrgency(0) does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.setUrgency(0);
      }).not.toThrow();
    });

    it('setUrgency(1) does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.setUrgency(1);
      }).not.toThrow();
    });

    it('click() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.click();
      }).not.toThrow();
    });

    it('confirm() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.confirm();
      }).not.toThrow();
    });

    it('judge(0) does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.judge(0);
      }).not.toThrow();
    });

    it('judge(1) does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.judge(1);
      }).not.toThrow();
    });

    it('setMuted(true) does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.setMuted(true);
      }).not.toThrow();
    });

    it('setMuted(false) does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.setMuted(false);
      }).not.toThrow();
    });
  });

  describe('isMuted() reflects setMuted() state', () => {
    it('isMuted() starts as false', () => {
      const audio = createAudio();
      expect(audio.isMuted()).toBe(false);
    });

    it('isMuted() returns true after setMuted(true)', () => {
      const audio = createAudio();
      audio.setMuted(true);
      expect(audio.isMuted()).toBe(true);
    });

    it('isMuted() returns false after setMuted(false)', () => {
      const audio = createAudio();
      audio.setMuted(true);
      audio.setMuted(false);
      expect(audio.isMuted()).toBe(false);
    });
  });

  describe('re-entrancy and idempotence', () => {
    it('startBgm() twice followed by stopBgm() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.startBgm();
        audio.startBgm();
        audio.stopBgm();
      }).not.toThrow();
    });

    it('stopBgm() without startBgm() does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.stopBgm();
      }).not.toThrow();
    });

    it('stopBgm() twice does not throw', () => {
      const audio = createAudio();
      expect(() => {
        audio.stopBgm();
        audio.stopBgm();
      }).not.toThrow();
    });
  });
});
