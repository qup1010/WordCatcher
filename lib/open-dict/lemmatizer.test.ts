import { describe, expect, it } from 'vitest'
import { getLemmatizeCandidates } from './lemmatizer'

describe('lemmatizer', () => {
  it('handles exact words', () => {
    expect(getLemmatizeCandidates('cat')).toContain('cat')
    expect(getLemmatizeCandidates('Book')).toContain('book')
  })

  it('handles plurals and third-person singulars', () => {
    expect(getLemmatizeCandidates('cats')).toEqual(expect.arrayContaining(['cats', 'cat']))
    expect(getLemmatizeCandidates('cities')).toEqual(expect.arrayContaining(['cities', 'city']))
    expect(getLemmatizeCandidates('boxes')).toEqual(expect.arrayContaining(['boxes', 'box']))
    expect(getLemmatizeCandidates('wolves')).toEqual(expect.arrayContaining(['wolves', 'wolf']))
    expect(getLemmatizeCandidates('knives')).toEqual(expect.arrayContaining(['knives', 'knife']))
  })

  it('handles past tense and participles', () => {
    expect(getLemmatizeCandidates('devastated')).toEqual(expect.arrayContaining(['devastated', 'devastate']))
    expect(getLemmatizeCandidates('walked')).toEqual(expect.arrayContaining(['walked', 'walk']))
    expect(getLemmatizeCandidates('studied')).toEqual(expect.arrayContaining(['studied', 'study']))
    expect(getLemmatizeCandidates('stopped')).toEqual(expect.arrayContaining(['stopped', 'stop']))
  })

  it('handles continuous tenses (-ing)', () => {
    expect(getLemmatizeCandidates('running')).toEqual(expect.arrayContaining(['running', 'run']))
    expect(getLemmatizeCandidates('making')).toEqual(expect.arrayContaining(['making', 'make']))
    expect(getLemmatizeCandidates('reading')).toEqual(expect.arrayContaining(['reading', 'read']))
    expect(getLemmatizeCandidates('dying')).toEqual(expect.arrayContaining(['dying', 'die']))
  })

  it('handles irregular verbs and nouns', () => {
    expect(getLemmatizeCandidates('went')).toEqual(expect.arrayContaining(['went', 'go']))
    expect(getLemmatizeCandidates('children')).toEqual(expect.arrayContaining(['children', 'child']))
    expect(getLemmatizeCandidates('better')).toEqual(expect.arrayContaining(['better', 'good']))
  })
})
