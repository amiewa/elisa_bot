'use strict';
const {
  NGramStore,
  BOS,
  EOS,
  calculateScore,
  pickNextToken,
  learn,
  generate,
  injectEmojis
} = require('../../src/lib/markov');

// =====================================================================
// NGramStore
// =====================================================================

describe('NGramStore', () => {
  describe('初期状態', () => {
    test('size が 0', () => {
      const store = new NGramStore();
      expect(store.size).toBe(0);
    });

    test('getDirtyEntries が空配列', () => {
      const store = new NGramStore();
      expect(store.getDirtyEntries()).toEqual([]);
    });
  });

  describe('load', () => {
    test('行配列からロードできる', () => {
      const store = new NGramStore();
      store.load([
        ['猫', '犬', 3, '2026-01-01T00:00:00.000Z'],
        ['犬', '鳥', 1, '2026-01-02T00:00:00.000Z'],
      ]);
      expect(store.size).toBe(2);
    });

    test('ヘッダなしの配列を想定する', () => {
      const store = new NGramStore();
      store.load([['a', 'b', 1, '2026-01-01T00:00:00.000Z']]);
      expect(store.size).toBe(1);
    });

    test('不正な行はスキップする', () => {
      const store = new NGramStore();
      store.load([null, [], ['a', 'b', 2, '2026-01-01T00:00:00.000Z']]);
      expect(store.size).toBe(1);
    });

    test('ロード後は dirty が空', () => {
      const store = new NGramStore();
      store.load([['a', 'b', 1, '2026-01-01T00:00:00.000Z']]);
      expect(store.getDirtyEntries()).toEqual([]);
    });
  });

  describe('add', () => {
    test('新規ペアを追加する', () => {
      const store = new NGramStore();
      store.add('猫', '犬');
      expect(store.size).toBe(1);
    });

    test('既存ペアの count を増やす', () => {
      const store = new NGramStore();
      store.add('猫', '犬');
      store.add('猫', '犬');
      const candidates = store.getNextCandidates('猫');
      expect(candidates[0].count).toBe(2);
    });

    test('add 後は dirty エントリに含まれる', () => {
      const store = new NGramStore();
      store.add('猫', '犬');
      const dirty = store.getDirtyEntries();
      expect(dirty.length).toBe(1);
      expect(dirty[0][0]).toBe('猫');
      expect(dirty[0][1]).toBe('犬');
    });

    test('isNew=false で既存ペアの count が増える', () => {
      const store = new NGramStore();
      store.add('a', 'b', true);
      store.add('a', 'b', false);
      const candidates = store.getNextCandidates('a');
      expect(candidates[0].count).toBe(2);
    });

    test('isNew=false で存在しないペアは追加しない', () => {
      const store = new NGramStore();
      store.add('a', 'b', false);
      expect(store.size).toBe(0);
    });
  });

  describe('getNextCandidates', () => {
    test('既存 prevToken の候補を返す', () => {
      const store = new NGramStore();
      store.add('猫', '犬');
      store.add('猫', '鳥');
      const candidates = store.getNextCandidates('猫');
      expect(candidates.length).toBe(2);
      const tokens = candidates.map((c) => c.token);
      expect(tokens).toContain('犬');
      expect(tokens).toContain('鳥');
    });

    test('存在しない prevToken で空配列を返す', () => {
      const store = new NGramStore();
      expect(store.getNextCandidates('unknown')).toEqual([]);
    });
  });

  describe('prune', () => {
    test('maxRows 以内なら削除しない', () => {
      const store = new NGramStore();
      store.add('a', 'b');
      store.add('c', 'd');
      store.prune(10, 0.05);
      expect(store.size).toBe(2);
    });

    test('maxRows を超えた場合に超過分を削除する', () => {
      const store = new NGramStore();
      // count=1 を4件追加
      store.add('a', 'b');
      store.add('c', 'd');
      store.add('e', 'f');
      store.add('g', 'h');
      store.prune(2, 0.05);
      expect(store.size).toBe(2);
    });

    test('prune 後の dirty に count=0 エントリが含まれる', () => {
      const store = new NGramStore();
      store.add('a', 'b');
      store.add('c', 'd');
      store.add('e', 'f');
      store.prune(1, 0.05);
      const dirty = store.getDirtyEntries();
      const deleted = dirty.filter((row) => row[2] === 0);
      expect(deleted.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// =====================================================================
// calculateScore
// =====================================================================

describe('calculateScore', () => {
  test('count=1, days=0 → log(1)=0', () => {
    expect(calculateScore(1, 0, 0.05)).toBeCloseTo(0);
  });

  test('count=10, days=0 → log(10)≈2.302', () => {
    expect(calculateScore(10, 0, 0.05)).toBeCloseTo(Math.log(10));
  });

  test('count=1, days=10, decay=0.05 → 0 - 0.5 = -0.5', () => {
    expect(calculateScore(1, 10, 0.05)).toBeCloseTo(-0.5);
  });

  test('count=0 → -Infinity', () => {
    expect(calculateScore(0, 0, 0.05)).toBe(-Infinity);
  });

  test('count=undefined → -Infinity', () => {
    expect(calculateScore(undefined, 0, 0.05)).toBe(-Infinity);
  });
});

// =====================================================================
// pickNextToken
// =====================================================================

describe('pickNextToken', () => {
  test('候補が1つなら常にそれを返す', () => {
    const candidates = [{ token: '猫', count: 5 }];
    expect(pickNextToken(candidates, () => 0)).toBe('猫');
    expect(pickNextToken(candidates, () => 0.999)).toBe('猫');
  });

  test('空配列は null を返す', () => {
    expect(pickNextToken([], Math.random)).toBeNull();
  });

  test('null は null を返す', () => {
    expect(pickNextToken(null, Math.random)).toBeNull();
  });

  test('rng=()=>0 は最初の候補を返す', () => {
    const candidates = [
      { token: 'a', count: 1 },
      { token: 'b', count: 100 }
    ];
    // r=0 なので累積 >= 0 を満たす最初の候補 'a' が返る
    expect(pickNextToken(candidates, () => 0)).toBe('a');
  });

  test('rng=()=>0.9999 は末尾候補を返す', () => {
    const candidates = [
      { token: 'a', count: 1 },
      { token: 'b', count: 1 }
    ];
    // total=2, r=0.9999*2=1.9998 → cumulative: 1 < 1.9998, 2 >= 1.9998 → 'b'
    expect(pickNextToken(candidates, () => 0.9999)).toBe('b');
  });
});

// =====================================================================
// learn
// =====================================================================

describe('learn', () => {
  test('BOS/EOS 付き bigram が追加される', () => {
    const store = new NGramStore();
    learn([['猫', '犬']], store);
    // BOS→猫, 猫→犬, 犬→EOS の3ペア
    expect(store.size).toBe(3);
    expect(store.getNextCandidates(BOS).map((c) => c.token)).toContain('猫');
    expect(store.getNextCandidates('猫').map((c) => c.token)).toContain('犬');
    expect(store.getNextCandidates('犬').map((c) => c.token)).toContain(EOS);
  });

  test('空文はスキップする', () => {
    const store = new NGramStore();
    learn([[], ['猫', '犬']], store);
    expect(store.size).toBe(3);
  });

  test('複数文を学習する', () => {
    const store = new NGramStore();
    learn([['a', 'b'], ['c', 'd']], store);
    // BOS→a, a→b, b→EOS, BOS→c, c→d, d→EOS
    // BOS には a と c の2候補
    const bosNext = store.getNextCandidates(BOS).map((c) => c.token);
    expect(bosNext).toContain('a');
    expect(bosNext).toContain('c');
  });

  test('isNewPairAllowed=false のとき新規ペアを追加しない', () => {
    const store = new NGramStore();
    learn([['猫', '犬']], store, false);
    expect(store.size).toBe(0);
  });

  test('isNewPairAllowed=false のとき既存ペアの count は増える', () => {
    const store = new NGramStore();
    // まず通常学習で追加
    learn([['猫', '犬']], store, true);
    const before = store.getNextCandidates('猫')[0].count;
    // F1 学習
    learn([['猫', '犬']], store, false);
    const after = store.getNextCandidates('猫')[0].count;
    expect(after).toBe(before + 1);
  });
});

// =====================================================================
// generate
// =====================================================================

describe('generate', () => {
  function makeStore(pairs) {
    const store = new NGramStore();
    for (const [prev, next, count] of pairs) {
      for (let i = 0; i < (count || 1); i++) store.add(prev, next);
    }
    return store;
  }

  const defaultConfig = {
    sentences_min: 1,
    sentences_max: 1,
    min_length: 1,
    max_length: 140,
    emoji_rate: 0
  };

  test('基本的な生成が成功する', () => {
    const store = makeStore([
      [BOS, '今日', 3],
      ['今日', 'は', 3],
      ['は', EOS, 3]
    ]);
    const result = generate(store, defaultConfig, [], () => 0);
    expect(result).toBeTruthy();
    expect(result).toContain('今日');
  });

  test('BOS から始まる候補がない場合は null を返す', () => {
    const store = new NGramStore();
    const result = generate(store, defaultConfig, [], Math.random);
    expect(result).toBeNull();
  });

  test('A1: min_length 未満の文は生成結果に含まれない', () => {
    // 「a」(1文字) を生成するが min_length=5 なので skip
    const store = makeStore([
      [BOS, 'a', 5],
      ['a', EOS, 5]
    ]);
    const config = { ...defaultConfig, min_length: 5, sentences_max: 3 };
    const result = generate(store, config, [], Math.random);
    // 常に1文字しか生成できないので null が返る
    expect(result).toBeNull();
  });

  test('B1: max_length を超える文は追加されない', () => {
    // 'あいうえお'(5文字) を2文生成しようとするが max_length=6 で2文目は入らない
    const store = makeStore([
      [BOS, 'あいうえお', 5],
      ['あいうえお', EOS, 5]
    ]);
    const config = { sentences_min: 2, sentences_max: 2, min_length: 1, max_length: 6, emoji_rate: 0 };
    const result = generate(store, config, [], () => 0);
    // 1文目(5文字) + 句点(1) = 6、2文目は入れない
    // emoji_rate=0 なのでinjectEmojis は句点で結合するが1文のみなら末尾なし
    expect(result).toBe('あいうえお');
  });

  test('文数が sentences_min〜sentences_max の範囲に収まる', () => {
    const store = makeStore([
      [BOS, 'あ', 10],
      ['あ', EOS, 10]
    ]);
    const config = { sentences_min: 2, sentences_max: 4, min_length: 1, max_length: 500, emoji_rate: 0 };
    const results = [];
    for (let i = 0; i < 20; i++) {
      const r = generate(store, config, [], Math.random);
      if (r) results.push(r.split('。').filter(Boolean).length);
    }
    // emoji_rate=0 なので文はすべて句点で結合される
    // 全ての結果が 1〜4 の範囲（0文=null で除外）
    for (const count of results) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(4);
    }
  });
});

// =====================================================================
// injectEmojis
// =====================================================================

describe('injectEmojis', () => {
  test('rate=0 → 全て句点区切り、最終文末なし', () => {
    const result = injectEmojis(['一文目', '二文目', '三文目'], [], 0, Math.random);
    expect(result).toBe('一文目。二文目。三文目');
  });

  test('rate=100, emojis あり → 全て絵文字注入', () => {
    const result = injectEmojis(['一文目', '二文目'], [':tada:'], 100, () => 0);
    // 文間: 絵文字, 末尾: 絵文字
    expect(result).toBe('一文目:tada:二文目:tada:');
  });

  test('emojis が空配列 → 句点のみ（エラーなし）', () => {
    const result = injectEmojis(['一文目', '二文目'], [], 100, () => 0);
    expect(result).toBe('一文目。二文目');
  });

  test('文が1つ、rate=0 → 末尾なし', () => {
    const result = injectEmojis(['一文目'], [], 0, Math.random);
    expect(result).toBe('一文目');
  });

  test('文が1つ、rate=100 → 末尾に絵文字', () => {
    const result = injectEmojis(['一文目'], [':wave:'], 100, () => 0);
    expect(result).toBe('一文目:wave:');
  });

  test('sentences が空 → 空文字', () => {
    expect(injectEmojis([], [':a:'], 50, Math.random)).toBe('');
  });
});
