/** Stream only the requested DAW mix or solo stems. No whole-library decoding on phones. */
export function createRenderedPlayback() {
  let generation = 0;
  let streams: HTMLAudioElement[] = [];
  let frame: number | undefined;
  const stop = () => {
    generation++;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    streams.forEach(audio => audio.pause());
  };
  return {
    stop,
    play(urls: readonly string[], seconds: number, tick: (seconds: number) => void, ended: () => void, failed: () => void) {
      stop();
      const mine = generation;
      const group = urls.map(url => {
        const audio = new Audio(url);
        audio.preload = 'none';
        audio.muted = true;
        audio.currentTime = seconds;
        return audio;
      });
      streams = group;
      let finished = false;
      const fail = () => {
        if (mine !== generation || finished) return;
        finished = true;
        stop();
        failed();
      };
      group.forEach(audio => {
        audio.onerror = fail;
        audio.onended = () => {
          if (mine !== generation || finished || !group.every(item => item.ended)) return;
          finished = true;
          stop();
          ended();
        };
      });
      void Promise.all(group.map(audio => audio.play())).then(async () => {
        if (mine !== generation) { group.forEach(audio => audio.pause()); return; }
        // All streams are ready before any is heard. Keep solo stems on one clock.
        group.forEach(audio => audio.pause());
        await Promise.all(group.map(audio => new Promise<void>(resolve => {
          audio.onseeked = () => resolve();
          audio.currentTime = seconds;
          if (!audio.seeking) resolve();
        })));
        if (mine !== generation) { group.forEach(audio => audio.pause()); return; }
        group.forEach(audio => { audio.muted = false; });
        await Promise.all(group.map(audio => audio.play()));
        if (mine !== generation) { group.forEach(audio => audio.pause()); return; }
        const follow = () => {
          if (mine !== generation || finished) return;
          const lead = group[0];
          if (lead && !lead.paused) {
            group.slice(1).forEach(audio => {
              if (!audio.paused && Math.abs(audio.currentTime - lead.currentTime) > .08) audio.currentTime = lead.currentTime;
            });
            tick(lead.currentTime);
          }
          frame = requestAnimationFrame(follow);
        };
        frame = requestAnimationFrame(follow);
      }).catch(fail);
    },
  };
}
