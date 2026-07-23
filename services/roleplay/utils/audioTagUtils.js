'use strict';

const AUDIO_TAG_REGEX = /\[[^\]]{1,40}\]/g;

const AUDIO_TAG_INSTRUCTIONS = `When forming your responses, use ElevenLabs audio expression tags in square brackets to make your voice delivery more natural and contextually appropriate. Place each tag directly before the text it should affect.

Available tags:
- Emotions: [excited], [happily], [sad], [angry], [tired], [sorrowful], [nervous], [frustrated]
- Delivery: [whispers], [shouts], [pause], [rushed], [drawn out]
- Reactions: [laughs], [sighs], [laughs softly], [clears throat]

Guidelines:
- Use tags sparingly and only when they genuinely match the tone or emotion.
- Place the tag right before the word or phrase it affects.
- Tags are processed by the voice system and are NEVER visible to the user.

Example: "[excited] That's fantastic! [happily] I would love to help you with that."`;


function stripAudioTags(text) {
  if (!text) return text;
  return text.replace(AUDIO_TAG_REGEX, '').replace(/\s{2,}/g, ' ').trim();
}


function appendAudioTagInstructions(systemPrompt) {
  const separator = systemPrompt ? '\n\n' : '';
  return `${systemPrompt || ''}${separator}${AUDIO_TAG_INSTRUCTIONS}`;
}

function isElevenLabsV3(ttsMeta = {}) {
  const provider = ttsMeta?.voiceData?.apiKeyId?.serviceProvider;
  const model = ttsMeta?.model;
  // eleven_v3 is the default in elevenlabsTTS() when model is not specified
  return provider === 'eleven_labs' && (model === 'eleven_v3' || !model);
}

module.exports = { stripAudioTags, appendAudioTagInstructions, isElevenLabsV3 };
