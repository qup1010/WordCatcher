/**
 * 单词形态还原（Lemmatizer）候选生成器。
 *
 * 划词划到的常是屈折变形（复数、过去式、进行时、比较级等）。
 * 给定输入单词，按规则生成可能的原型候选列表（按优先级由高到低）。
 */

const IRREGULAR_MAP: Record<string, string> = {
  am: 'be',
  is: 'be',
  are: 'be',
  was: 'be',
  were: 'be',
  been: 'be',
  being: 'be',
  has: 'have',
  had: 'have',
  having: 'have',
  does: 'do',
  did: 'do',
  done: 'do',
  doing: 'do',
  went: 'go',
  gone: 'go',
  goes: 'go',
  going: 'go',
  came: 'come',
  comes: 'come',
  coming: 'come',
  took: 'take',
  taken: 'take',
  takes: 'take',
  taking: 'take',
  saw: 'see',
  seen: 'see',
  sees: 'see',
  seeing: 'see',
  got: 'get',
  gotten: 'get',
  gets: 'get',
  getting: 'get',
  knew: 'know',
  known: 'know',
  knows: 'know',
  knowing: 'know',
  made: 'make',
  makes: 'make',
  making: 'make',
  thought: 'think',
  thinks: 'think',
  thinking: 'think',
  told: 'tell',
  tells: 'tell',
  telling: 'tell',
  felt: 'feel',
  feels: 'feel',
  feeling: 'feel',
  found: 'find',
  finds: 'find',
  finding: 'find',
  gave: 'give',
  given: 'give',
  gives: 'give',
  giving: 'give',
  wrote: 'write',
  written: 'write',
  writes: 'write',
  writing: 'write',
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
  less: 'little',
  least: 'little',
  more: 'much',
  most: 'much',
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  geese: 'goose',
  people: 'person',
  leaves: 'leaf',
  wolves: 'wolf',
  halves: 'half',
  knives: 'knife',
  lives: 'life',
  wives: 'wife',
  shelves: 'shelf',
  thieves: 'thief',
  crises: 'crisis',
  analyses: 'analysis',
}

/**
 * 为输入的单词生成原型候选列表。
 * 返回数组按最可能匹配的顺序排列，第一个永远是单词本身（小写去除标点）。
 */
export function getLemmatizeCandidates(rawWord: string): string[] {
  const word = rawWord.trim().toLowerCase().replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, '')
  if (!word || word.length < 2) return word ? [word] : []

  const candidates: string[] = [word]
  const add = (c: string) => {
    if (c && c.length >= 2 && !candidates.includes(c)) {
      candidates.push(c)
    }
  }

  // 1. 不规则变形优先查找
  if (IRREGULAR_MAP[word]) {
    add(IRREGULAR_MAP[word])
  }

  const len = word.length

  // 2. 名词复数 / 动词单三 (-ies, -es, -s)
  if (word.endsWith('ies') && len > 3) {
    add(`${word.slice(0, -3)}y`) // cities -> city, studies -> study
  } else if (word.endsWith('ves') && len > 3) {
    add(`${word.slice(0, -3)}f`) // wolves -> wolf, leaves -> leaf
    add(`${word.slice(0, -3)}fe`) // knives -> knife, lives -> life
  } else if (word.endsWith('es') && len > 3) {
    add(word.slice(0, -2)) // boxes -> box, watches -> watch
    add(word.slice(0, -1)) // cas-es -> case
  } else if (word.endsWith('s') && !word.endsWith('ss') && len > 3) {
    add(word.slice(0, -1)) // dogs -> dog
  }

  // 3. 过去式 / 过去分词 (-ied, -ed)
  if (word.endsWith('ied') && len > 3) {
    add(`${word.slice(0, -3)}y`) // applied -> apply
  } else if (word.endsWith('ed') && len > 3) {
    add(word.slice(0, -1)) // devastated -> devastate, loved -> love
    add(word.slice(0, -2)) // walked -> walk
    // 双写辅音还原：stopped -> stop, planned -> plan
    if (
      len > 4 &&
      word[len - 3] === word[len - 4] &&
      !['l', 's', 'z'].includes(word[len - 3])
    ) {
      add(word.slice(0, -3))
    }
  }

  // 4. 现在分词 / 动名词 (-ying, -ing)
  if (word.endsWith('ying') && len > 4) {
    add(`${word.slice(0, -4)}ie`) // dying -> die, lying -> lie
  } else if (word.endsWith('ing') && len > 4) {
    add(`${word.slice(0, -3)}e`) // making -> make, dancing -> dance
    add(word.slice(0, -3)) // reading -> read
    // 双写辅音还原：running -> run, swimming -> swim
    if (
      len > 5 &&
      word[len - 4] === word[len - 5] &&
      !['l', 's', 'z'].includes(word[len - 4])
    ) {
      add(word.slice(0, -4))
    }
  }

  // 5. 比较级与最高级 (-ier/-iest, -er/-est)
  if (word.endsWith('ier') && len > 3) {
    add(`${word.slice(0, -3)}y`) // happier -> happy
  } else if (word.endsWith('iest') && len > 4) {
    add(`${word.slice(0, -4)}y`) // happiest -> happy
  } else if (word.endsWith('er') && len > 3) {
    add(word.slice(0, -1)) // nicer -> nice
    add(word.slice(0, -2)) // faster -> fast
    if (len > 4 && word[len - 3] === word[len - 4]) {
      add(word.slice(0, -3)) // bigger -> big
    }
  } else if (word.endsWith('est') && len > 4) {
    add(word.slice(0, -2)) // nicest -> nice
    add(word.slice(0, -3)) // fastest -> fast
    if (len > 5 && word[len - 4] === word[len - 5]) {
      add(word.slice(0, -4)) // biggest -> big
    }
  }

  // 6. 副词 (-ily, -ly)
  if (word.endsWith('ily') && len > 3) {
    add(`${word.slice(0, -3)}y`) // easily -> easy, happily -> happy
  } else if (word.endsWith('ly') && len > 3) {
    add(word.slice(0, -2)) // quickly -> quick
  }

  return candidates
}
