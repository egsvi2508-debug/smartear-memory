// Background music: lo-fi beats, all CC0 (public domain): free to use anywhere,
// including Instagram reels, no credit required. Sources: public/music/CREDITS.txt.
export interface Track {
  file: string;
  title: string;
  artist: string;
  /** How many times to play it in a row. */
  loops: number;
}

export const PLAYLIST: Track[] = [
  { file: "holizna-poor-but-happy.mp3", title: "Poor, But Happy", artist: "Holizna", loops: 1 },
  { file: "holizna-blue-skies.mp3", title: "Blue Skies", artist: "Holizna", loops: 1 },
  { file: "holizna-letting-go-of-the-past.mp3", title: "Letting Go Of The Past", artist: "Holizna", loops: 1 },
  { file: "holizna-puppy-love.mp3", title: "Puppy Love", artist: "Holizna", loops: 1 },
  { file: "holizna-clouds.mp3", title: "Clouds", artist: "Holizna", loops: 1 },
  { file: "holizna-happy-but-a-little-off.mp3", title: "Happy, but a little off", artist: "Holizna", loops: 1 },
  { file: "holizna-new-shoes.mp3", title: "New Shoes", artist: "Holizna", loops: 1 },
  { file: "holizna-city-in-the-rearview.mp3", title: "City In The Rearview", artist: "Holizna", loops: 1 },
  { file: "holizna-families.mp3", title: "Families", artist: "Holizna", loops: 1 },
  { file: "holizna-opinions.mp3", title: "Opinions", artist: "Holizna", loops: 1 },
  { file: "holizna-old-age.mp3", title: "Old Age", artist: "Holizna", loops: 1 },
  { file: "holizna-dream-pop.mp3", title: "Dream Pop", artist: "Holizna", loops: 1 },
  { file: "holizna-autumn.mp3", title: "Autumn", artist: "Holizna", loops: 1 },
  { file: "holizna-not-it.mp3", title: "Not It", artist: "Holizna", loops: 1 },
  { file: "holizna-fire-place.mp3", title: "Fire Place", artist: "Holizna", loops: 1 },
  { file: "holizna-small-towns-smaller-lives.mp3", title: "Small Towns Smaller Lives", artist: "Holizna", loops: 1 },
  { file: "holizna-winter-blues.mp3", title: "Winter Blues", artist: "Holizna", loops: 1 },
  { file: "holizna-all-the-way-sad.mp3", title: "All The Way Sad", artist: "Holizna", loops: 1 },
  { file: "holizna-shut-up-or-shut-in.mp3", title: "Shut up, or shut in", artist: "Holizna", loops: 1 },
  { file: "holizna-yesterday.mp3", title: "Yesterday", artist: "Holizna", loops: 1 },
  { file: "tad-a-cup-of-tea.mp3", title: "A Cup of Tea", artist: "TAD", loops: 1 },
  { file: "tad-bartender.mp3", title: "Bartender", artist: "TAD", loops: 1 },
  { file: "tad-cat-caffe.mp3", title: "Cat Caffe", artist: "TAD", loops: 1 },
  { file: "tad-countryside.mp3", title: "Countryside", artist: "TAD", loops: 1 },
  { file: "tad-cue.mp3", title: "Cue", artist: "TAD", loops: 1 },
  { file: "tad-florist.mp3", title: "Florist", artist: "TAD", loops: 1 },
  { file: "tad-morning-rain.mp3", title: "Morning Rain", artist: "TAD", loops: 2 },
  { file: "tad-oceanside.mp3", title: "Oceanside", artist: "TAD", loops: 1 },
  { file: "tad-rainy-forest.mp3", title: "Rainy Forest", artist: "TAD", loops: 1 },
  { file: "omfgdude-chill-lofi.mp3", title: "Chill Lofi", artist: "omfgdude", loops: 1 },
];
