// 看圖說句遊戲
function initSpeakGame(area, words) {
  const supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  if (!supported) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">你的瀏覽器不支援語音辨識，請使用 Chrome 瀏覽器。</p>';
    return;
  }

  const total = Math.min(8, words.length);
  const queue = shuffleArray(words).slice(0, total);
  let current = 0;
  let correct = 0;

  function renderQuestion() {
    if (current >= queue.length) {
      showResult(correct, total);
      return;
    }
    const target = queue[current];
    const img = getRandomImage(target);
    const sentence = getRandomSentence(target);

    area.innerHTML = `
      <div class="speak-container">
        ${img ? `<img class="speak-image" src="${img}" alt="" onerror="this.style.display='none'" />` : ''}
        <div class="speak-hint">用這個單字說一個句子：</div>
        <div class="speak-word">${esc(target.word)} (${esc(target.meaning)})</div>
        ${sentence ? `<div style="color:#999;font-size:.9em;margin-bottom:12px;">提示：${esc(sentence)}</div>` : ''}
        <button class="speak-mic" id="micBtn" aria-label="開始錄音">🎙️</button>
        <div class="speak-transcript" id="transcript">點麥克風開始說話...</div>
        <div style="margin-top:12px;color:#999;">${current + 1} / ${total}</div>
      </div>
    `;

    const micBtn = document.getElementById('micBtn');
    const transcriptEl = document.getElementById('transcript');
    let recognition = null;

    micBtn.addEventListener('click', () => {
      if (recognition) {
        recognition.stop();
        return;
      }
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;

      micBtn.classList.add('recording');
      transcriptEl.textContent = '正在聽...';

      recognition.onresult = (e) => {
        let transcript = '';
        for (let i = 0; i < e.results.length; i++) {
          transcript += e.results[i][0].transcript;
        }
        transcriptEl.textContent = transcript || '...';

        // 檢查是否包含目標單字
        if (e.results[0].isFinal) {
          const lower = transcript.toLowerCase();
          const wordLower = target.word.toLowerCase();
          const found = lower.includes(wordLower);
          if (found) {
            transcriptEl.innerHTML = `✅ <strong>${transcript}</strong>`;
            transcriptEl.style.background = '#e8f5e9';
            correct++;
          } else {
            transcriptEl.innerHTML = `💪 "${transcript}" — 試試包含 <strong>${target.word}</strong>`;
            transcriptEl.style.background = '#fff3e0';
          }
          updateProgress(target.id, found, 'speak', { mistakes: found ? 0 : 1 });
          document.getElementById('gameScore').textContent = `${correct} / ${current + 1}`;
          micBtn.classList.remove('recording');
          recognition = null;
          setTimeout(() => { current++; renderQuestion(); }, 2500);
        }
      };

      recognition.onerror = () => {
        transcriptEl.textContent = '聽不清楚，再試一次？';
        micBtn.classList.remove('recording');
        recognition = null;
      };

      recognition.onend = () => {
        micBtn.classList.remove('recording');
        recognition = null;
      };

      recognition.start();
    });
  }

  renderQuestion();
}
