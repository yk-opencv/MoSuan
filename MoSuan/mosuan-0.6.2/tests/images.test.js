// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { validateImages } from '../server/images.js';
import { buildContext } from '../server/context.js';
describe('image request validation and history budget', () => {
  const image = { name: '题目.jpg', dataUrl: 'data:image/jpeg;base64,/9j/AA==' };
  it('keeps embedded supported images and rejects remote or executable sources', () => {
    expect(validateImages([image])).toEqual([image]);
    for (const dataUrl of ['https://example.com/a.jpg', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA', 'data:image/jpeg;base64,' + 'a'.repeat(750001)]) expect(() => validateImages([{ dataUrl }])).toThrow();
    expect(validateImages(Array(7).fill(image))).toHaveLength(7);
    expect(() => validateImages(Array(8).fill(image))).toThrow('7 张');
  });
  it('retains image content in selected turns and preserves whole turns when image budget is exhausted', () => {
    const huge = { ...image, dataUrl: 'x'.repeat(2_200_000) };
    const history = [
      { role: 'user', content: 'old', images: [huge] }, { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'recent', images: [huge] }, { role: 'assistant', content: 'recent answer' },
      { role: 'user', content: 'new', images: [huge] },
    ];
    const context = buildContext(history, 12);
    expect(context.historyMessages).toBe(2);
    expect(context.messages.at(-1).images).toEqual([huge]);
    expect(context.messages.some(message => message.content === 'old')).toBe(false);
  });
  it('keeps complete turns within the upstream ten-image limit', () => {
    const history = Array.from({ length: 6 }, (_, index) => [{ role: 'user', content: String(index), images: [image,image,image] }, { role: 'assistant', content: 'answer' }]).flat();
    const context = buildContext([...history, { role: 'user', content: 'new', images: [image,image,image] }], 12);
    expect(context.messages.reduce((sum, message) => sum + (message.images?.length || 0), 0)).toBe(9);
    expect(context.historyMessages).toBe(4);
  });
});
