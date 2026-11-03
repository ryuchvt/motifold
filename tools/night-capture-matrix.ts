import { TEMPLATES } from '../app/orchestra';

export const NIGHT_SOURCE = {
  path: 'public/demo/sample-sketch/sample-sketch.musicxml',
  sha256: 'a8b4ee04a41ee125b8e7e042fe6c5dd3baf82fe65fd588eac6823770a9b8304f',
  bars: 24,
  notes: 114,
};
export const NIGHT_MOODS = ['Neutral', 'Sad', 'Tender', 'Hopeful', 'Dreamy', 'Pastoral', 'Wonder', 'Storybook', 'Playful', 'Heroic', 'Epic', 'Pulse', 'Action', 'Tense', 'Dark'] as const;
export interface NightRecipe {
  id: string;
  intent: 'arrange' | 'expand' | 'recompose';
  ensemble: string;
  instruments: string[];
  mood: typeof NIGHT_MOODS[number];
  bars: number;
  moreBars: number;
  where: 'inside' | 'both' | 'after';
  tuneOnly: false;
  freedom: 2;
}
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const recipe = (intent: NightRecipe['intent'], ensemble: typeof TEMPLATES[number], mood: NightRecipe['mood'] = 'Neutral'): NightRecipe => ({
  id: `${intent}-${slug(mood)}-${slug(ensemble.name)}`, intent, ensemble: ensemble.name, instruments: [...ensemble.instruments], mood,
  bars: intent === 'arrange' ? 24 : intent === 'expand' ? 40 : 32,
  moreBars: intent === 'expand' ? 16 : intent === 'recompose' ? 32 : 0, where: intent === 'expand' ? 'both' : intent === 'recompose' ? 'after' : 'inside', tuneOnly: false, freedom: 2,
});
const recompositions = TEMPLATES.flatMap(ensemble => NIGHT_MOODS.map(mood => recipe('recompose', ensemble, mood)));
/** One explicit start captures A and B. No call is started by enumerating this matrix. */
export const NIGHT_RECIPES: NightRecipe[] = [
  ...TEMPLATES.map(ensemble => recipe('arrange', ensemble)),
  ...TEMPLATES.map(ensemble => recipe('expand', ensemble)),
  ...recompositions.filter(item => item.ensemble === 'Full orchestra'),
  ...recompositions.filter(item => item.ensemble !== 'Full orchestra'),
];
