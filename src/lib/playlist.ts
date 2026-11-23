// Background music: beats (hip-hop, lo-fi, funk, retro wave), picked for a
// strong steady groove. All CC0 (public domain): free to use anywhere,
// including Instagram reels, no credit required. Sources: public/music/CREDITS.txt.
export interface Track {
  file: string;
  title: string;
  artist: string;
  /** How many times to play it in a row. */
  loops: number;
}

export const PLAYLIST: Track[] = [
  { file: "holizna-dear-mr-super-computer.mp3", title: "Dear Mr Super Computer", artist: "Holizna", loops: 1 },
  { file: "holizna-50-over-the-speed-limit.mp3", title: "50 Over The Speed Limit", artist: "Holizna", loops: 1 },
  { file: "holizna-mutant-club.mp3", title: "Mutant Club", artist: "Holizna", loops: 1 },
  { file: "holizna-retro-soundtrack.mp3", title: "Retro Soundtrack", artist: "Holizna", loops: 1 },
  { file: "holizna-final-level.mp3", title: "Final Level", artist: "Holizna", loops: 1 },
  { file: "holizna-shut-up-or-shut-in.mp3", title: "Shut up, or shut in", artist: "Holizna", loops: 1 },
  { file: "holizna-hard-mode.mp3", title: "Hard Mode", artist: "Holizna", loops: 1 },
  { file: "holizna-whatever.mp3", title: "Whatever", artist: "Holizna", loops: 1 },
  { file: "holizna-cyber-anxiety.mp3", title: "Cyber Anxiety", artist: "Holizna", loops: 1 },
  { file: "holizna-legends.mp3", title: "Legends", artist: "Holizna", loops: 1 },
  { file: "holizna-retro-synths.mp3", title: "Retro Synths", artist: "Holizna", loops: 1 },
  { file: "holizna-yesterday.mp3", title: "Yesterday", artist: "Holizna", loops: 1 },
  { file: "holizna-machines-with-feelings.mp3", title: "Machines With Feelings", artist: "Holizna", loops: 1 },
  { file: "holizna-autumn.mp3", title: "Autumn", artist: "Holizna", loops: 1 },
  { file: "holizna-ramen.mp3", title: "Ramen", artist: "Holizna", loops: 1 },
  { file: "holizna-coins.mp3", title: "Coins", artist: "Holizna", loops: 1 },
  { file: "rami99-piano-hip-hop.mp3", title: "Piano Hip Hop", artist: "Rami99", loops: 2 },
  { file: "holizna-small-towns-smaller-lives.mp3", title: "Small Towns Smaller Lives", artist: "Holizna", loops: 1 },
  { file: "holizna-transcendental-earth-people.mp3", title: "transcendental earth people", artist: "Holizna", loops: 1 },
  { file: "holizna-all-the-way-sad.mp3", title: "All The Way Sad", artist: "Holizna", loops: 1 },
  { file: "holizna-make-funk.mp3", title: "Make Funk", artist: "Holizna", loops: 1 },
  { file: "holizna-earth.mp3", title: "Earth", artist: "Holizna", loops: 1 },
  { file: "tad-countryside.mp3", title: "Countryside", artist: "TAD", loops: 2 },
  { file: "tad-a-cup-of-tea.mp3", title: "A Cup of Tea", artist: "TAD", loops: 1 },
  { file: "holizna-happy-dance.mp3", title: "Happy Dance", artist: "Holizna", loops: 1 },
  { file: "holizna-sleep.mp3", title: "Sleep", artist: "Holizna", loops: 1 },
  { file: "holizna-day-dreams.mp3", title: "Day Dreams", artist: "Holizna", loops: 1 },
  { file: "tad-florist.mp3", title: "Florist", artist: "TAD", loops: 1 },
  { file: "holizna-everything-you-ever-dreamed.mp3", title: "Everything You Ever Dreamed", artist: "Holizna", loops: 1 },
  { file: "tad-rainy-forest.mp3", title: "Rainy Forest", artist: "TAD", loops: 1 },
  { file: "holizna-fire-place.mp3", title: "Fire Place", artist: "Holizna", loops: 1 },
  { file: "holizna-a-small-town-on-pluto.mp3", title: "A Small Town On Pluto", artist: "Holizna", loops: 1 },
  { file: "holizna-glad-to-be-stuck-inside.mp3", title: "Glad To Be Stuck Inside", artist: "Holizna", loops: 1 },
  { file: "holizna-we-used-to-dance.mp3", title: "We used To Dance", artist: "Holizna", loops: 1 },
  { file: "umplix-silent-dance-floor.mp3", title: "Silent Dance Floor", artist: "Umplix", loops: 2 },
  { file: "holizna-letting-go-of-the-past.mp3", title: "Letting Go Of The Past", artist: "Holizna", loops: 1 },
  { file: "holizna-winter-blues.mp3", title: "Winter Blues", artist: "Holizna", loops: 1 },
  { file: "holizna-poor-but-happy.mp3", title: "Poor, But Happy", artist: "Holizna", loops: 1 },
  { file: "holizna-night-life.mp3", title: "Night Life", artist: "Holizna", loops: 1 },
  { file: "holizna-eat.mp3", title: "Eat", artist: "Holizna", loops: 1 },
  { file: "tad-cat-caffe.mp3", title: "Cat Caffe", artist: "TAD", loops: 1 },
  { file: "holizna-vintage.mp3", title: "Vintage", artist: "Holizna", loops: 1 },
  { file: "holizna-make-money.mp3", title: "Make Money", artist: "Holizna", loops: 1 },
  { file: "fupi-funky-disco-beats.mp3", title: "Funky Disco Beats", artist: "Fupi", loops: 1 },
  { file: "umplix-can-t-resist-the-groove.mp3", title: "Can't Resist the Groove", artist: "Umplix", loops: 2 },
  { file: "holizna-opinions.mp3", title: "Opinions", artist: "Holizna", loops: 1 },
  { file: "holizna-old-age.mp3", title: "Old Age", artist: "Holizna", loops: 1 },
  { file: "tad-oceanside.mp3", title: "Oceanside", artist: "TAD", loops: 1 },
  { file: "holizna-not-it.mp3", title: "Not It", artist: "Holizna", loops: 1 },
];
