export const site = {
  name: 'Pílenie stromov Orava',
  legalName: 'Jozef - Arboristika',
  tagline: 'Rizikový výrub stromov a lanové pílenie',
  url: 'https://pilimestromy.sk',
  locale: 'sk-SK',
  address: {
    street: '',
    zip: '029 01',
    city: 'Námestovo',
    full: 'Námestovo, 029 01',
  },
  contact: {
    phone: '0907 339 732',
    phoneHref: 'tel:+421907339732',
    email: 'info@pilimestromy.sk',
    emailHref: 'mailto:info@pilimestromy.sk',
    whatsapp: 'https://wa.me/421907339732',
  },
  registry: {
    ico: '',
    dic: '',
    icDph: '',
  },
  serviceArea: 'Žilinský kraj',
  hero: {
    headingLine1: 'Bezpečné a precízne arboristické služby',
    headingLine2: 'v Žilinskom kraji',
    sub: 'Lanové pílenie, rizikový výrub a práce v náročnom teréne s bezplatnou obhliadkou a ukážkami našich prác.',
    ctaLabel: 'Zavolať',
    image: '/images/hero.webp',
  },
  about: {
    body: 'Jozef - Arboristika sa špecializuje na lanové pílenie a rizikový výrub stromov v Žilinskom kraji. S využitím stromolezeckej lanovej techniky poskytuje bezpečné a efektívne riešenia.',
    youtubeEmbed: 'https://www.youtube.com/embed/-jkdM6VJtEM?si=SNAgwzAJtnXjzUxu&autoplay=1&mute=1&playsinline=1&loop=1&playlist=-jkdM6VJtEM&controls=1',
  },
  features: {
    heading: 'Bezpečné a presné výruby stromov s Jozefom',
  },
  footerTagline: 'Špecializované arboristické služby v Žilinskom kraji s dôrazom na bezpečnosť a efektivitu.',
  nav: [
    { label: 'Domov', href: '/#domov' },
    { label: 'O nás', href: '/#o-nas' },
    { label: 'Služby', href: '/#sluzby' },
    { label: 'Galéria', href: '/#galeria' },
    { label: 'Referencie', href: '/#referencie' },
    { label: 'Kontakt', href: '/#kontakt' },
  ],
  footerLinks: [
    { label: 'Domov', href: '/#domov' },
    { label: 'O nás', href: '/#o-nas' },
    { label: 'Služby', href: '/#sluzby' },
    { label: 'Galéria', href: '/#galeria' },
    { label: 'Referencie', href: '/#referencie' },
    { label: 'Kontakt', href: '/#kontakt' },
  ],
  social: [
    { label: 'WhatsApp', href: 'https://wa.me/421907339732', icon: 'lucide:message-circle' },
  ],
  meta: {
    title: 'Rizikový výrub stromov a lanové pílenie | Pílenie stromov Orava',
    description: 'Bezpečné a precízne arboristické služby v Žilinskom kraji. Lanové pílenie, rizikový výrub a práce v náročnom teréne s bezplatnou obhliadkou.',
    keywords: 'lanové pílenie stromov, rizikový výrub stromov, arboristika, pílenie stromov Orava, výrub stromov Námestovo, Žilinský kraj, ťažba dreva',
  },
} as const;

export const features = [
  {
    id: 'profesionalna-arboristika',
    title: 'Profesionálna arboristika',
    description: 'Lanové pílenie stromov umožňuje bezpečný výrub v náročných podmienkach.',
    image: '/images/feature-1.webp',
    icon: 'lucide:arrow-up-right',
  },
  {
    id: 'rizikovy-vyrub',
    title: 'Rizikový výrub',
    description: 'Odstraňovanie stromov v tesnej blízkosti budov, vedení a prekážok.',
    image: '/images/feature-2.webp',
    icon: 'lucide:bar-chart-3',
  },
  {
    id: 'tazko-dostupne-miesta',
    title: 'Prístup do ťažko dostupných miest',
    description: 'Pílenie stromov v neprístupnom teréne a náročnom prostredí.',
    image: '/images/feature-3.webp',
    icon: 'lucide:shield-check',
  },
] as const;

export const services = [
  {
    id: 'lanove-pilenie-stromov',
    title: 'Lanové pílenie stromov',
    description: 'Bezpečné a precízne pílenie stromov pomocou stromolezeckej lanovej techniky.',
    image: '/images/service-1-lanove-pilenie.webp',
  },
  {
    id: 'rizikovy-vyrub-stromov',
    title: 'Rizikový výrub stromov',
    description: 'Odstraňovanie stromov nachádzajúcich sa v tesnej blízkosti budov, vedení alebo iných prekážok.',
    image: '/images/service-2-rizikovy-vyrub.webp',
  },
  {
    id: 'tazko-pristupne-miesta',
    title: 'Pílenie stromov v ťažko prístupných miestach',
    description: 'Špecializovaný výrub stromov v strmom, neprístupnom alebo náročnom teréne.',
    image: '/images/service-3-tazko-pristupne.webp',
  },
  {
    id: 'bezplatna-obhliadka',
    title: 'Bezplatná obhliadka prác',
    description: 'Nezáväzná obhliadka stromov a stanovenie optimálneho postupu.',
    image: '/images/service-4-obhliadka.webp',
  },
  {
    id: 'tazba-dreva',
    title: 'Ťažba dreva',
    description: 'Ťažba dreva zahŕňa bezpečné rezanie a spracovanie stromov v ťažko prístupných miestach.',
    image: '/images/service-5-tazba-dreva.webp',
  },
] as const;

export const testimonials = [
  {
    author: 'Vladimír',
    rating: 5,
    text: 'Skvelá spolupráca, výrub stromov prebehol hladko a bezpečne. Odporúčam.',
  },
  {
    author: 'Božena',
    rating: 5,
    text: 'Lanové pílenie stromov bolo profesionálne a rýchle. Spoľahlivé služby.',
  },
  {
    author: 'Štefan',
    rating: 5,
    text: 'Rizikový výrub stromov zvládnutý presne podľa dohody. Odporúčam každému.',
  },
] as const;

export type SluzbaPageData = {
  slug: string;
  metaTitle: string;
  metaDescription: string;
  breadcrumb: string;
  hero: {
    h1: string;
    sub: string;
    image: string;
  };
  intro: string;
  topicalSections: { heading: string; body: string }[];
  whatsIncluded: { heading: string; items: string[] };
  materials: { heading: string; body: string };
  process: { heading: string; steps: { title: string; body: string }[] };
  pricing: { heading: string; body: string };
  faqs: { q: string; a: string }[];
  finalCTA: { heading: string; body: string };
};

export const sluzbyPages: Record<string, SluzbaPageData> = {
  'lanove-pilenie-stromov': {
    slug: 'lanove-pilenie-stromov',
    metaTitle: 'Lanové pílenie stromov na Orave a v Žilinskom kraji | Pílenie stromov Orava',
    metaDescription:
      'Lanové pílenie stromov stromolezeckou technikou SRT pre stromy v blízkosti budov, vedení a v ťažkom teréne. Námestovo, Trstená, Tvrdošín, Dolný Kubín. Obhliadka zadarmo.',
    breadcrumb: 'Lanové pílenie stromov',
    hero: {
      h1: 'Lanové pílenie stromov na Orave a v celom Žilinskom kraji',
      sub: 'Spílime a bezpečne odstránime aj strom, ku ktorému sa plošina ani autožeriav nedostanú. Stromolezec sa lanom dostane do koruny a po častiach ho kontrolovane spustí k zemi. Pôsobíme v Námestove a okolí, obhliadka aj cenová ponuka sú zadarmo, štandardne do troch pracovných dní.',
      image: '/images/service-1-lanove-pilenie.webp',
    },
    intro:
      'Lanové pílenie zvládne to, na čo plošina ani autožeriav nemajú miesto. Stromolezec sa lanom dostane do koruny, postupne odpiľuje konáre zhora nadol a kontrolovane ich spúšťa k zemi. Pri citlivých priestoroch je lano často jediná možnosť, ako strom dostať dolu bez škody na okolí.\n\nPôsobíme v Námestove, Trstenej, Tvrdošíne, Dolnom Kubíne a Žiline, ako aj v okolitých obciach po celom Žilinskom kraji.',
    topicalSections: [
      {
        heading: 'Kedy je lanové pílenie jediná možnosť',
        body:
          'Stromy v blízkosti rodinných domov, plotov, vedení elektriny alebo telekomunikácií sa nedajú pustiť celým kmeňom k zemi. Riziko škody je príliš vysoké. Lanová technika rieši presne tieto situácie. Stromolezec rozdelí strom na časti, ktoré sa kontrolovane spustia na vopred určené miesto. Rovnako pracujeme pri stromoch v úzkych dvoroch, nad strechou, nad bazénom alebo nad záhradným altánkom. Často sa stretávame so situáciou, kde sa dva-tri konáre dotýkajú strešného odkvapu alebo siete nízkeho napätia. Plošina sa tam nedostane, autožeriav nemá kde stáť. Lano a stromolezec sú v takých prípadoch najrozumnejšia voľba, lebo umiestnenie rezu vieme prispôsobiť na centimeter.',
      },
      {
        heading: 'Stromolezecká technika SRT a MRT',
        body:
          'V korune používame dve metódy istenia. SRT (single rope technique) znamená, že stromolezec stúpa po jednom statickom lane prevlečenom cez vhodný kotviaci bod v korune. Je rýchlejšia, šetrnejšia k stromu a vhodná na výšky nad 15 metrov. MRT (moving rope technique) využíva lano prehodené cez konár, pričom stromolezec pracuje na dvojnásobnej vetve lana. Hodí sa na nižšie stromy a na časté presuny v menšej korune. Pri obidvoch metódach používame mechanické friction hitch zariadenia Petzl ZigZag alebo Akimbo, ktoré sú dnes štandardom v profesionálnej arboristike. Zariadenia umožňujú plynulý pohyb hore aj dolu jednou rukou a uvoľnenie pílu druhou.',
      },
      {
        heading: 'Postroje, lana, prilba a istiace prostriedky',
        body:
          'Postroj musí sedieť a musí byť určený na prácu vo výške v korune stromu, nie na priemyselné lezenie. Pracujeme s Petzl Sequoia SRT a Teufelberger Treemotion Evo. Lana sú statické, priemer 11 mm a 11,7 mm, od značiek Yale, Teufelberger a Edelrid. Pri spúšťaní konárov používame samostatné rigging lano (Yale Stable Braid alebo Teufelberger Sirius Bull) v priemere 12,7 mm s vyššou pevnosťou v ťahu. Prilba je Petzl Vertex Vent s integrovanou ochranou tváre. K tomu rukavice, chrániče holení a rezné nohavice na zem. Každý kus výbavy má dátum kontroly a je vedený v evidencii.',
      },
      {
        heading: 'Vyšetrenie stromu pred výrubom',
        body:
          'Pred prvým rezom sa pozrieme na strom z viacerých strán. Kontrolujeme prasknutia v kmeni, dutiny, hubu na koreni, suché konáre v korune a smer prirodzeného naklonenia. Ak je strom napadnutý hubou alebo má dutinu, musíme s tým počítať pri voľbe kotviacich bodov a pri smere padania konárov. Niekedy sa ukáže, že strom nie je možné liezť a treba ho riešiť autožeriavom alebo opačným smerom. Vyšetrenie nás stojí 10 až 20 minút a šetrí hodiny problémov neskôr. Ak má strom známky napadnutia podpňovkou alebo trasovkou, navrhneme aj postup spracovania pňa a koreňového systému, aby choroba nepokračovala na ďalšie stromy.',
      },
      {
        heading: 'Postupný orez koruny zhora nadol',
        body:
          'Po vystúpení do koruny začíname zhora. Najprv vrchol, potom obvodové konáre, postupne nadol. Každý konár ide buď voľne k zemi, ak je dosť miesta, alebo cez rigging lano s kontrolovaným spúšťaním. Rezy robíme krátkymi pílami Stihl MS 201 T alebo Husqvarna T540 XP, ktoré sú špecificky stavané na prácu jednou rukou v korune. Veľké konáre delíme na časti a každú spúšťame osobitne. Pri vetvách s priemerom nad 15 cm vždy používame spúšťacie zariadenie, pretože pád takého konára z desiatich metrov vyvinie silu, ktorú nezachytí ani strom ani človek na zemi. Po koruna prejdeme na kmeň a delíme ho po metroch.',
      },
      {
        heading: 'Rigging a kontrolované spúšťanie konárov',
        body:
          'Rigging je samostatná disciplína. Konár pripevníme rigging lanom o vrchnejšiu časť stromu, odpílime, a kolega na zemi pomocou brzdy lano kontrolovane povoľuje. Brzdu používame Stein RC2001 alebo Petzl Maestro, kladky Petzl Pulley P50 alebo DMM Hitch Climber. Voľba zariadenia závisí od hmotnosti konára. Pri ľahších konároch (do 50 kg) stačí jednoduchý friction wrap okolo kmeňa. Pri ťažkých konároch nad 100 kg ide o presný systém s niekoľkými kladkami a brzdou na zemi. Bez rigging výbavy by sa pracovalo iba pri stromoch, kde sa konáre môžu padať voľne, čo je v dvore alebo nad strechou nereálne.',
      },
      {
        heading: 'Spracovanie a odvoz drevnej hmoty',
        body:
          'Po výrube zostane na zemi kopa konárov a kusov kmeňa. Konáre buď spracujeme na štiepku štiepkovačom, alebo necháme zložené na vami určenom mieste. Kmeň narežeme na metrové polená alebo na palivové dĺžky podľa toho, čo si želáte. Drevo môžeme odviezť, ak máte záujem, alebo zostane vám. Odvoz dohodneme pri obhliadke, lebo závisí od množstva a od prístupu pre vlečku. Pracovný priestor po sebe upraceme. Triesky a piliny zhrabeme, aspoň hrubo, aby ste si nemuseli ihneď po odchode čistiť dvor.',
      },
    ],
    whatsIncluded: {
      heading: 'Čo je v cene',
      items: [
        'Obhliadka stromu a okolia priamo u vás',
        'Cenová ponuka v pevnej sume na základe obhliadky',
        'Kompletná stromolezecká výbava (lano, postroj, prilba, motorové píly)',
        'Rigging výbava na kontrolované spúšťanie konárov',
        'Spracovanie konárov a kmeňa na zemi',
        'Hrubé upratanie pracovného priestoru',
        'Záruku a spôsob reklamácie dohodneme pri obhliadke',
      ],
    },
    materials: {
      heading: 'Výbava a materiály',
      body:
        'Pracujeme s motorovými pílami Stihl (MS 201 T pre prácu vo výške, MS 261 a MS 462 pre rezy kmeňa) a Husqvarna T540 XP. Lana od Yale, Teufelberger a Edelrid v priemere 11 mm a 11,7 mm. Postroje Petzl Sequoia SRT a Teufelberger Treemotion Evo. Prilba Petzl Vertex Vent s ochranou tváre, friction hitch zariadenia ZigZag a Akimbo. Pri spúšťaní ťažkých konárov používame brzdy Stein RC2001 alebo Petzl Maestro a kladky Petzl P50 alebo DMM Hitch Climber. Každý kus má dátum poslednej kontroly v evidencii.',
    },
    process: {
      heading: 'Ako to prebieha',
      steps: [
        {
          title: 'Telefonát alebo formulár',
          body: 'Opíšete strom, polohu a prístup. Ak môžete, pošlite fotku z dvoch strán. Aspoň približne nám pomôže odhadnúť rozsah.',
        },
        {
          title: 'Obhliadka na mieste',
          body: 'Prídeme zvyčajne do troch pracovných dní. Premeriame strom, posúdime zdravie, prejdeme rizikové miesta okolo, dohodneme termín výrubu.',
        },
        {
          title: 'Cenová ponuka',
          body: 'Pevná suma na základe obhliadky. Cena z obhliadky je tá, ktorá pôjde aj na faktúru, ak sa nezmení rozsah práce.',
        },
        {
          title: 'Realizácia',
          body: 'Stromolezec ide do koruny, postupne píluje a spúšťa konáre. Kolega na zemi rieši rigging a spracovanie odpíleného materiálu.',
        },
        {
          title: 'Upratanie a odovzdanie',
          body: 'Odvezieme drevnú hmotu, ak ste si to objednali. Inak zložíme na vami určenom mieste. Pracovný priestor po sebe upraceme.',
        },
      ],
    },
    pricing: {
      heading: 'Cena',
      body:
        'Cenu určíme po obhliadke. Záleží na výške stromu, druhu dreviny, prístupe pre vlečku a na tom, či potrebujete len výrub alebo aj odvoz dreva. Pri orientačnej cene cez telefón vám povieme rozpätie, presnú sumu vždy až po obhliadke. Obhliadka aj cenová ponuka sú zadarmo a nezáväzné.',
    },
    faqs: [
      {
        q: 'Aký vysoký strom dokážete spíliť lanovou technikou?',
        a: 'Štandardne pracujeme so stromami do 30 metrov. Vyšších sa nebojíme, ale predtým sa musíme pozrieť na strom a na okolie. Pri stromoch nad 25 metrov vždy preverujeme stav koruny a kotviace body pred prvým výstupom.',
      },
      {
        q: 'Robíte aj v zime?',
        a: 'Áno. Pri snehu a poľadovici pracujeme opatrnejšie, ale stromolezecká technika funguje celý rok. V zime navyše menej zaťažujeme záhradu, lebo zem je tvrdá a netvoria sa hlboké koľaje od vlečky.',
      },
      {
        q: 'Čo so spíleným drevom?',
        a: 'Buď ho narežeme na palivové dĺžky a necháme zložené na vami určenom mieste, alebo odvezieme. Konáre vieme spracovať aj na štiepku, ak máte záujem o mulč. Odvoz dohodneme pri obhliadke.',
      },
      {
        q: 'Pracujete len v Námestove?',
        a: 'Robíme po celej Orave (Námestovo, Trstená, Tvrdošín, Zuberec, Zákamenné, Oravská Polhora, Mútne) a v okrese Dolný Kubín. Po dohode sa dostaneme aj do Liptova alebo do Žiliny.',
      },
      {
        q: 'Dáte mi cenovú ponuku cez telefón?',
        a: 'Hrubú orientáciu áno, presnú cenu až po obhliadke. Stromy z fotky nie vždy ukazujú prístup, sklon terénu a stav koruny. Obhliadka trvá 15 až 20 minút a je zadarmo.',
      },
      {
        q: 'Máte poistenie zodpovednosti za škodu?',
        a: 'Áno. Doklad ukážeme pri obhliadke. Pre prípad nečakanej škody na nehnuteľnosti alebo na vedení sme krytí počas celej realizácie.',
      },
    ],
    finalCTA: {
      heading: 'Potrebujete spíliť strom v ťažkom mieste?',
      body: 'Zavolajte alebo napíšte. Prídeme sa pozrieť, dohodneme cenu a termín. Obhliadka zadarmo.',
    },
  },
  'rizikovy-vyrub-stromov': {
    slug: 'rizikovy-vyrub-stromov',
    metaTitle: 'Rizikový výrub stromov na Orave a v Žilinskom kraji | Pílenie stromov Orava',
    metaDescription:
      'Bezpečné odstránenie stromov v tesnej blízkosti budov, vedení elektriny a v zastavanom prostredí. Námestovo, Trstená, Tvrdošín, Dolný Kubín, Žilina. Obhliadka zadarmo.',
    breadcrumb: 'Rizikový výrub stromov',
    hero: {
      h1: 'Rizikový výrub stromov na Orave a v celom Žilinskom kraji',
      sub: 'Bezpečné odstránenie stromov v blízkosti budov, vedení a v zastavanom prostredí. Obhliadka aj cenová ponuka zadarmo, štandardne do troch pracovných dní.',
      image: '/images/service-2-rizikovy-vyrub.webp',
    },
    intro:
      'Rizikový výrub je každý prípad, kde sa strom nedá pustiť voľne na zem. Pri stromoch v blízkosti rodinných domov, oplotení, vedení nízkeho a vysokého napätia, telekomunikačných sietí alebo nad strechou ide o presný rez na presné miesto. Skúsenosti, výbava a komunikácia s majiteľom siete sú to, čo rozlišuje rizikový výrub od bežného výrubu v lese.\n\nPôsobíme v Námestove, Trstenej, Tvrdošíne, Dolnom Kubíne a Žiline, ako aj v okolitých obciach po celom Žilinskom kraji.',
    topicalSections: [
      {
        heading: 'Kedy je výrub rizikový',
        body:
          'Strom je rizikový vtedy, keď v okolí má niečo, čo nesmie utrpieť škodu. Najčastejšie ide o rodinné domy, garáže, oplotenie, parkované autá, záhradné stavby alebo živé vedenia. Druhým prípadom je strom, ktorý je sám o sebe v zlom stave, má trhliny v kmeni, dutiny, hubu na koreni alebo suché vetvy v korune. Tretí prípad sú stromy na verejných priestranstvách, kde sa pod nimi denne pohybujú ľudia. V každej z týchto situácií platí, že chyba pri výrube znamená škodu na majetku alebo zranenie. Vlastné posúdenie stromu, premietnutie smeru pádu a voľba techniky robia rozdiel medzi bezpečným odstránením a nehodou.',
      },
      {
        heading: 'Stromy pri vedení elektriny a telekomunikácií',
        body:
          'Pri stromoch v blízkosti vedenia nízkeho napätia (do 1 kV) alebo vysokého napätia (22 kV a viac) je potrebná zvýšená pozornosť. Pri rozhodujúcich prácach kontaktujeme distribučnú spoločnosť (Stredoslovenská distribučná pre Žilinský kraj) a vyžiadame si vypnutie linky alebo aspoň informovanie o našej činnosti. Telekomunikačné vedenia (Slovak Telekom, Orange) sú menej nebezpečné, ale ich poškodenie znamená výpadok internetu a telefónu na celej ulici. Pri stromoch nad vedením používame lanovú techniku alebo plošinu a každý konár spúšťame kontrolovane riggingom. Voľný pád konára na vedenie je vždy zakázaný a vždy ho riešime zvlášť.',
      },
      {
        heading: 'Stromy nad strechou a v blízkosti budov',
        body:
          'Pri stromoch s korunou nad strechou alebo s kmeňom v tesnej blízkosti múru je potrebný kompletný postupný odber zhora nadol. Spustenie celého stromu padacím rezom na takom mieste nie je možné. Stromolezec vystúpi do koruny, odpíli najprv najmenšie konáre, postupne väčšie, a každý kus spúšťa lanom k zemi. Posledný kmeň pílime po metrových úsekoch, ktoré ručne alebo lanom prenášame na bezpečné miesto. Pri stromoch nad bazénom, garážou alebo zimnou záhradou ide o jediný možný spôsob výrubu, ktorý nevyvolá riziko škody. Časovo náročnejší než klasický výrub v lese, ale jediný správny.',
      },
      {
        heading: 'Posúdenie zdravotného stavu stromu pred výrubom',
        body:
          'Pred prvým rezom kontrolujeme strom z viacerých strán. Pozeráme sa na koreň, kmeň a korunu. Hľadáme trhliny, dutiny, suché konáre, znaky hubových chorôb (podpňovka, trasovka, lievikovec). Stromy napadnuté hubou majú často vnútorne uvoľnené drevo, ktoré sa správa inak pri rezaní a pri kotvení. Pri pochybnostiach použijeme rezonančný test (poklepanie na kmeň gumovým kladivom). Ak má strom dutinu väčšiu ako tretinu priemeru kmeňa, nevolíme klasický rez, ale špeciálny postup. Pri starých alebo poškodených stromoch sa rozhodujeme aj o tom, či vôbec liezť, alebo radšej použiť autožeriav.',
      },
      {
        heading: 'Plánovanie smeru pádu a kontrolovaného spúšťania',
        body:
          'Pri stromoch, kde je voľné padnutie možné aspoň pre časť stromu, vopred určíme smer pádu. Smer závisí od prirodzeného naklonenia, hmotnosti koruny, smeru vetra a od toho, kde má strom najviac voľného priestoru. Ak je smer prirodzeného pádu opačný než potrebný, použijeme klin a navádzacie lano. Klin je drevený alebo plastový kus, ktorý do podpilu vrazíme a tým strom prevrátime do žiadaného smeru. Pri ťažkých stromoch nad 5 ton hmotnosti používame aj kladkový systém s ručným navijakom. Plánovanie smeru pádu trvá viac ako samotný rez.',
      },
      {
        heading: 'Spolupráca s majiteľom siete pri rizikových výruboch',
        body:
          'Pri stromoch nad vedením elektriny, plynu alebo telekomunikácií informujeme príslušnú distribučnú spoločnosť pred začiatkom prác. Pri vysokom napätí (22 kV) je vypnutie linky zvyčajne potrebné, a tu rezervujeme termín so Stredoslovenskou distribučnou aspoň 14 dní vopred. Pri nízkom napätí (do 1 kV) stačí oznámenie, ale práca prebieha s extra opatrnosťou. Niekedy distribučná spoločnosť pošle vlastných pracovníkov na dohľad, čo predĺži termín, ale zníži riziko. Pri plynovom potrubí (SPP-distribúcia) je vždy potrebná konzultácia, lebo poškodenie potrubia môže spôsobiť únik plynu.',
      },
      {
        heading: 'Likvidácia, odvoz a upratanie po výrube',
        body:
          'Po výrube zostávajú na zemi konáre, štiepky a kmeň. Konáre buď zoštiepkujeme štiepkovačom (priemer do 12 cm), alebo necháme zložené. Kmeň narežeme na palivové dĺžky 33 cm, 50 cm alebo na metrové polená podľa vašej požiadavky. Drevo odvezieme vlečkou, ak máte záujem, alebo zostáva vám. Odvoz je za príplatok podľa množstva a vzdialenosti. Pracovný priestor po sebe upraceme, hrubo zhrabeme triesky a piliny. Pri stromoch nad zatrávnenou plochou si dávame pozor na pošliapanie trávy ťažkou vlečkou. V zimnom období koľaje v rozmočenej zemi nevznikajú a robíme s ľahšou stopou.',
      },
    ],
    whatsIncluded: {
      heading: 'Čo je v cene',
      items: [
        'Obhliadka stromu a okolia priamo u vás',
        'Cenová ponuka v pevnej sume na základe obhliadky',
        'Konzultácia s majiteľom siete pri rizikových výruboch',
        'Stromolezecká a rigging výbava na kontrolované spúšťanie',
        'Spracovanie konárov a kmeňa na zemi',
        'Hrubé upratanie pracovného priestoru',
        'Poistenie zodpovednosti za škodu počas realizácie',
      ],
    },
    materials: {
      heading: 'Výbava a materiály',
      body:
        'Pri rizikových výruboch používame motorové píly Stihl MS 201 T pre prácu vo výške, MS 261 a MS 462 pre delenie kmeňa. Husqvarna T540 XP pre druhého stromolezca. Stromolezecká výbava Petzl Sequoia SRT, Teufelberger Treemotion, prilba Petzl Vertex Vent. Pri riggingu používame brzdy Stein RC2001, Petzl Maestro, kladky Petzl P50, DMM Hitch Climber. Lana statické 11 mm a 11,7 mm (Yale, Teufelberger, Edelrid), rigging lano 12,7 mm (Yale Stable Braid). Klin Stihl, navádzacie lano 30 metrov, ručný navijak Tirfor T-32 pre ťažké stromy. Každý kus výbavy má dátum kontroly a je vedený v evidencii.',
    },
    process: {
      heading: 'Ako to prebieha',
      steps: [
        {
          title: 'Telefonát alebo formulár',
          body: 'Opíšete strom, polohu, vedenia v okolí a prístup. Ak môžete, pošlite fotku z dvoch strán. Pomôže nám to lepšie odhadnúť rozsah.',
        },
        {
          title: 'Obhliadka na mieste',
          body: 'Prídeme zvyčajne do troch pracovných dní. Posúdime strom, premeriame okolie, vyznačíme vedenia a dohodneme termín výrubu.',
        },
        {
          title: 'Komunikácia s majiteľom siete',
          body: 'Pri rizikových stromoch nad vedením kontaktujeme distribučnú spoločnosť. Tento krok môže predĺžiť termín o 7 až 14 dní.',
        },
        {
          title: 'Realizácia',
          body: 'Stromolezec ide do koruny, postupne píluje a spúšťa konáre. Pri ťažkých kusoch riggingujeme kontrolovane k zemi.',
        },
        {
          title: 'Upratanie a odovzdanie',
          body: 'Odvezieme drevnú hmotu, ak ste si to objednali. Pracovný priestor po sebe upraceme, hrubo zhrabeme triesky.',
        },
      ],
    },
    pricing: {
      heading: 'Cena',
      body:
        'Cenu určíme po obhliadke. Záleží na výške stromu, druhu dreviny, prístupe, na tom, či je potrebná spolupráca s majiteľom siete, a či potrebujete odvoz dreva. Pri orientačnej cene cez telefón vám povieme rozpätie, presnú sumu vždy až po obhliadke. Obhliadka aj cenová ponuka sú zadarmo a nezáväzné. Pri stromoch nad vedením vysokého napätia je cena vyššia, lebo zahŕňa aj koordináciu s distribučnou spoločnosťou.',
    },
    faqs: [
      {
        q: 'Robíte aj výrub stromu, ktorý hrozí pádom?',
        a: 'Áno. Pri stromoch, ktoré sú vážne poškodené a hrozí ich pád, prichádzame prioritne. V kritickom prípade (ohrozenie života alebo cesty) sa pokúsime byť na mieste do 24 hodín.',
      },
      {
        q: 'Potrebujem povolenie na výrub stromu vo vlastnom dvore?',
        a: 'Pri stromoch s obvodom kmeňa nad 80 cm meraným vo výške 130 cm od zeme je potrebné povolenie obce alebo mestského úradu. Pri stromoch v záhrade pri rodinnom dome do tohto obvodu povolenie nie je potrebné. Pri stromoch mimo zastavané územie platia iné pravidlá.',
      },
      {
        q: 'Čo ak strom padá nesprávnym smerom?',
        a: 'Pri správne plánovanom výrube sa to nestáva. Predtým, než urobíme prvý rez, pozrieme sa na strom z viacerých strán, vypočítame váhu koruny, smer vetra a klinom upravíme prirodzený smer pádu. Pri pochybnostiach používame navádzacie lano alebo lanovú techniku.',
      },
      {
        q: 'Máte poistenie zodpovednosti za škodu?',
        a: 'Áno. Doklad o poistení ukážeme pri obhliadke. Pre prípad nečakanej škody na nehnuteľnosti alebo na vedení sme krytí počas celej realizácie.',
      },
      {
        q: 'Kontaktujete sa s elektrárňou alebo to musím urobiť ja?',
        a: 'Pri stromoch nad vedením vysokého napätia kontaktujeme distribučnú spoločnosť my. Vy nám len potvrdíte, že chcete prácu vykonať. Pri nízkom napätí stačí, ak distribučná spoločnosť bude informovaná, čo môže urobiť ktokoľvek.',
      },
      {
        q: 'Pracujete aj v zime?',
        a: 'Áno. Pri snehu a poľadovici pracujeme opatrnejšie, ale technika funguje celý rok. V zime navyše menej zaťažujeme záhradu, lebo zem je tvrdá a nehrozia hlboké koľaje od vlečky.',
      },
    ],
    finalCTA: {
      heading: 'Máte rizikový strom v blízkosti budovy?',
      body: 'Zavolajte alebo napíšte. Prídeme sa pozrieť, posúdime riziko a dohodneme bezpečný postup. Obhliadka zadarmo.',
    },
  },
  'tazko-pristupne-miesta': {
    slug: 'tazko-pristupne-miesta',
    metaTitle: 'Pílenie stromov v ťažko prístupných miestach v Žilinskom kraji | Pílenie stromov Orava',
    metaDescription:
      'Výrub stromov v strmom svahu, v neprístupnom teréne a tam, kde sa ťažká technika nedostane. Námestovo, Trstená, Tvrdošín, Dolný Kubín. Obhliadka zadarmo.',
    breadcrumb: 'Ťažko prístupné miesta',
    hero: {
      h1: 'Pílenie stromov v ťažko prístupných miestach v Žilinskom kraji',
      sub: 'Výrub stromov v strmom svahu, v neprístupnom teréne a tam, kde sa ťažká technika nedostane. Obhliadka aj cenová ponuka zadarmo.',
      image: '/images/service-3-tazko-pristupne.webp',
    },
    intro:
      'Ťažko prístupné miesto je každé, kam sa nedostane plošina ani autožeriav. Strmý svah, koniec poľnej cesty, breh potoka, okraj lesa, dvor s úzkym vjazdom. Náš dlhý lanový systém a stromolezecká technika nahrádzajú ťažkú techniku tam, kde sa nedostane.\n\nPôsobíme v Námestove, Trstenej, Tvrdošíne, Dolnom Kubíne a Žiline, ako aj v okolitých obciach po celom Žilinskom kraji.',
    topicalSections: [
      {
        heading: 'Kedy ide o ťažko prístupné miesto',
        body:
          'Klasická plošina (rebrík alebo košík) potrebuje minimálne 3 metre šírky a tvrdú zem. Autožeriav potrebuje aspoň 4 metre šírky a možnosť otočiť sa. Tam, kde to nie je, ide o ťažko prístupné miesto. Najčastejšie sú to záhrady na svahu s úzkym vjazdom (širokým najmenej 2,5 metra), okraj polí s lesom alebo živým plotom, brehy potokov a riek, kde plošina by mohla spadnúť do vody, lesné okraje pri rodinných domoch v podhorí Oravy, dvory v starej zástavbe (Námestovo, Trstená), kde sa pri stavbe nepočítalo s neskorším výrubom. Pri každej takejto situácii nahrádzame ťažkú techniku stromolezeckou výbavou a lanom.',
      },
      {
        heading: 'Práca v strmom svahu a na hraniciach pozemkov',
        body:
          'Pri stromoch v svahu so sklonom nad 20 stupňov nemá zmysel uvažovať o ťažkej technike. Pracujeme ručne, lanovou technikou, prípadne s pomocou pevného kotviaceho bodu (susedný strom, skala, kovová tyč zatlčená do zeme). Pri stromoch na hranici pozemkov dvoch susedov vždy preveríme s vlastníkmi, na ktorom pozemku je strom oficiálne. Pri spore o hranicu odporúčame zmeranie geodetom pred prácou, aby sme sa nedostali do sporu po výrube. Pri stromoch v ochrannom pásme cesty alebo vodného toku informujeme správcu cesty (Slovenská správa ciest) alebo vodohospodárov.',
      },
      {
        heading: 'Pílenie na okrajoch lesov a pri vodných tokoch',
        body:
          'Stromy na okraji lesa, hlavne tie, ktoré sa dotýkajú elektrického vedenia alebo prečnievajú nad cestu, sú časté zákazky. Pracujeme na vlastnom pozemku, ale aj na pozemku Lesov Slovenskej republiky po dohode so správcom lesa. Pri stromoch nad potokom alebo riekou (Biela Orava, Čierna Orava, Studená) zabezpečíme, aby konáre nepadli do toku a aby sa drevo nedostalo do vody. Voda by konáre niesla a mohli by upchať priepust. V chránenom pásme vodných tokov platí, že rezivo a odpad sa musí vyniesť, nesmie zostať blízko brehu.',
      },
      {
        heading: 'Dopravenie výbavy bez prístupu pre auto',
        body:
          'Pri zákazkách v neprístupných miestach nesieme výbavu ručne alebo pomocou ručného vozíka. Stromolezecká výbava jednej osoby váži 25 až 35 kg. Motorová píla 6 kg. Pohonné hmoty 5 litrov benzín, 2 litre olej. Pri vzdialenosti viac ako 200 metrov od auta plánujeme dva výjazdy pre celú výbavu. Pri zákazkách na chate alebo v salaši, kde nie je elektrina, používame motorovú pílu s benzínovým motorom. Elektrické píly sú menej výkonné a vyžadujú prúd. Pri ďalekých zákazkách (nad 1 hodinu chôdze) využívame štvorkolku alebo pomoc objednávateľa s autom.',
      },
      {
        heading: 'Spúšťanie stromu v obmedzenom priestore',
        body:
          'V obmedzenom priestore (úzky dvor, klin medzi dvoma budovami) je voľný pád stromu vylúčený. Stromolezec ide do koruny, postupne odpiľuje konáre a každý spúšťa lanom alebo ručne na vopred určené miesto. Pri kmeni v úzkom priestore rezáme krátke kúsky (30 až 50 cm), ktoré sa dajú prenesť. Pri stromoch s priemerom kmeňa nad 60 cm rátame so 6 až 10 hodinami práce na samotný kmeň. V niektorých prípadoch (medzi dvoma garážami, v dvore pod balkónom) je strom potrebné rozobrať po centimetri a každý kus oddeliť osobitne. Časovo veľmi náročné, ale bezpečné.',
      },
      {
        heading: 'Spracovanie a vynesenie drevnej hmoty',
        body:
          'Po výrube na ťažko prístupnom mieste je drevná hmota na zemi, ale ďaleko od auta. Konáre buď zoštiepkujeme priamo na mieste (ak je dosť priestoru pre štiepkovač), alebo necháme zložené. Kmeň narežeme na metrové polená, ktoré sa dajú niesť po jednom. Pri vlhkom dreve váži meter buka asi 25 kg, agátu 30 kg, smreka 15 kg. Vynášame po jednej osobe, alebo dvojici, podľa veľkosti. Pri väčších množstvách dohodneme špeciálny odvoz traktorom alebo vlečkou až po hranicu prístupnej cesty. Cenu za vynesenie kalkulujeme zvlášť od ceny za výrub.',
      },
      {
        heading: 'Riziká pri zlej dostupnosti a ako ich riešime',
        body:
          'V ťažko prístupných miestach sa zvyšuje riziko pádu pracovníka, zranenia nástrojom a problémov pri záchrane. Preto pracujeme vždy v dvoch a stromolezec má so sebou núdzové komunikačné zariadenie. Pri zákazkách v lese aktivujeme lokátor polohy. Pred prácou sa dohodneme na trase pre záchranárov, aby v prípade úrazu vedeli, kde sme. Pri prácach v zime alebo v daždi pracujeme len pri stavoch, kde je prístup ešte únosný. Pri silnom vetre (nad 30 km/h) lezenie do koruny prerušíme a počkáme. Bezpečnosť ide vždy pred rýchlosťou.',
      },
    ],
    whatsIncluded: {
      heading: 'Čo je v cene',
      items: [
        'Obhliadka stromu a posúdenie prístupu',
        'Cenová ponuka v pevnej sume na základe obhliadky',
        'Doprava stromolezeckej výbavy aj v neprístupnom teréne',
        'Stromolezecká a rigging výbava na kontrolované spúšťanie',
        'Spracovanie a delenie drevnej hmoty na mieste',
        'Vynesenie alebo zhromaždenie dreva na dohodnutom mieste',
        'Poistenie zodpovednosti za škodu počas realizácie',
      ],
    },
    materials: {
      heading: 'Výbava a materiály',
      body:
        'Pri zákazkách v ťažko prístupných miestach pracujeme s ľahšími pílami Stihl MS 201 T (3,9 kg) a Husqvarna T540 XP (3,9 kg) pre prácu vo výške. Pri kmeňoch s priemerom nad 50 cm berieme aj ťažšiu MS 462 (6 kg). Stromolezecký postroj Petzl Sequoia SRT, prilba Petzl Vertex Vent. Lana statické 11 mm a 11,7 mm v dĺžke 60 metrov, rigging lano 12,7 mm v dĺžke 30 metrov. Kotvenie do skaly alebo do zeme cez kovové ťahacie skoby. Pri presune cez svah karabíny Petzl Am’D, slingy Mammut, ascender Petzl Ascension. Pri prácach v lese máme aj malú lopatku a sekeru pre úpravu terénu.',
    },
    process: {
      heading: 'Ako to prebieha',
      steps: [
        {
          title: 'Telefonát alebo formulár',
          body: 'Opíšete miesto, prístup, sklon terénu a strom. Fotka z dvoch strán pomáha pri odhade rozsahu prác.',
        },
        {
          title: 'Obhliadka na mieste',
          body: 'Zvyčajne do troch pracovných dní. Posúdime prístup, premeriame strom a okolie, dohodneme termín aj postup.',
        },
        {
          title: 'Cenová ponuka',
          body: 'Pevná suma na základe obhliadky. Pri prácach v ťažkom teréne počítame aj cenu za vynesenie dreva.',
        },
        {
          title: 'Realizácia',
          body: 'Vynesieme výbavu, stromolezec ide do koruny alebo k stromu, postupne píluje a spúšťa konáre.',
        },
        {
          title: 'Vynesenie a odvoz',
          body: 'Drevo vynesieme na dohodnuté miesto (kraj cesty, dvor, sklad), prípadne odvezieme vlečkou.',
        },
      ],
    },
    pricing: {
      heading: 'Cena',
      body:
        'Cenu určíme po obhliadke. Pri ťažko prístupných miestach je cena vyššia ako v bežnom dvore, lebo počítame čas na dopravu výbavy, vynesenie dreva a špeciálne kotvenie. Pri orientačnej cene cez telefón povieme rozpätie, presnú sumu vždy po obhliadke. Obhliadka aj cenová ponuka sú zadarmo a nezáväzné. Pri stromoch v skutočne neprístupných miestach (chata v lese, vrchol kopca) sa cena môže pohybovať od 200 eur vyššie len za samotný transport výbavy.',
    },
    faqs: [
      {
        q: 'Dostanete sa na chatu, kde nevedie cesta?',
        a: 'Áno, ak je k chate aspoň chodník alebo poľná cesta, dostaneme sa. Pri zákazkách nad 1 km od cesty dohodneme dovoz výbavy traktorom alebo štvorkolkou. Pri vzdialenosti nad 2 km kalkulujeme čas na transport.',
      },
      {
        q: 'Pracujete v lese mimo zastavané územie?',
        a: 'Áno, po dohode s vlastníkom pozemku alebo s lesnou správou. Pri stromoch na pozemku Lesov SR potrebujeme písomný súhlas správcu.',
      },
      {
        q: 'Spravíte výrub stromu medzi domami, kde je len úzky pruh?',
        a: 'Áno, je to klasická lanová zákazka. Stromolezec ide do koruny, postupne odpiľuje konáre a kmeň. Čas zákazky je dlhší ako na voľnom priestranstve, ale fyzicky to možné je.',
      },
      {
        q: 'Vyjdete aj v silnom svahu, kde sa nedá stáť?',
        a: 'Pri svahu so sklonom do 35 stupňov pracujeme bežne. Pri silnejšom sklone používame kotviace lano a karabíny. Pri sklone nad 45 stupňov radšej príďte zo strany, kde sa dá stáť.',
      },
      {
        q: 'Robíte aj na pozemkoch mestských úradov?',
        a: 'Áno, po vyhratí zákazky alebo po objednávke. Pri verejných priestoroch obvykle hradí výrub mesto, my fakturujeme priamo mestu.',
      },
      {
        q: 'Spracujete drevo aj ďaleko od cesty?',
        a: 'Áno, palivové dĺžky narežeme priamo na mieste. Konáre buď zoštiepkujeme (ak je prístup pre štiepkovač), alebo necháme zložené. Odvoz dohodneme zvlášť.',
      },
    ],
    finalCTA: {
      heading: 'Máte strom v neprístupnom mieste?',
      body: 'Zavolajte alebo napíšte. Prídeme aj tam, kde sa ťažká technika nedostane. Obhliadka zadarmo.',
    },
  },
  'bezplatna-obhliadka': {
    slug: 'bezplatna-obhliadka',
    metaTitle: 'Bezplatná obhliadka stromu v Žilinskom kraji | Pílenie stromov Orava',
    metaDescription:
      'Prídeme sa pozrieť na váš strom, posúdime stav, vyznačíme rizikové miesta a navrhneme postup. Bez záväzku, bez poplatku. Námestovo, Trstená, Tvrdošín.',
    breadcrumb: 'Bezplatná obhliadka prác',
    hero: {
      h1: 'Bezplatná obhliadka stromu v Žilinskom kraji',
      sub: 'Prídeme sa pozrieť na váš strom, posúdime stav, vyznačíme rizikové miesta a navrhneme postup. Bez záväzku, bez poplatku.',
      image: '/images/service-4-obhliadka.webp',
    },
    intro:
      'Obhliadka je úvod každej spolupráce. Prídeme k vám, pozrieme sa na strom, premeriame okolie, posúdime možnosti výrubu a vypočítame cenu. Trvá to 15 až 30 minút podľa veľkosti stromu a zložitosti okolia. Obhliadka je bezplatná aj v prípade, že nakoniec spoluprácu nezačneme.\n\nPôsobíme v Námestove, Trstenej, Tvrdošíne, Dolnom Kubíne a Žiline, ako aj v okolitých obciach po celom Žilinskom kraji.',
    topicalSections: [
      {
        heading: 'Ako prebieha obhliadka',
        body:
          'Obhliadka začína dohodnutím termínu telefonicky alebo cez formulár. Zvyčajne sa dohodneme do troch pracovných dní. Pri obhliadke prídeme k vám domov, obrátime sa s vami a spolu si pozrieme strom. Najprv vás požiadame o opis problému (chcete strom úplne preč, alebo orezať konáre, alebo máte obavu z pádu). Potom strom obídeme z viacerých strán, premeriame výšku odhadom a priemer kmeňa pásmom, pozrieme sa do koruny, na koreň, na okolie. Pri pochybnostiach o vnútornom stave dreva poklepeme kladivom na kmeň. Na konci spolu prejdeme cenovú ponuku a možný termín.',
      },
      {
        heading: 'Čo si pri obhliadke všímame',
        body:
          'Hlavné body, ktoré pri obhliadke posudzujeme: výška stromu (od zeme po vrchol), priemer kmeňa vo výške 130 cm, druh dreviny (smrek, borovica, jaseň, javor, breza, agát, dub, buk, lipa), prirodzené naklonenie stromu, smer prevládajúceho vetra v lokalite, prítomnosť suchých konárov, viditeľné trhliny v kmeni, dutiny, hubové plodnice, znaky napadnutia podpňovkou alebo trasovkou, hustota koruny, smer možného pádu, vzdialenosť od najbližšej budovy a od vedenia, prístup pre techniku, sklon terénu, plocha pre odpiľované konáre.',
      },
      {
        heading: 'Posúdenie stavu stromu (zdravie, prasknutia, huba)',
        body:
          'Zdravotný stav stromu má vplyv na cenu aj na postup výrubu. Stromy v dobrom stave sa dajú výrubať rýchlo a klasicky, choré stromy si vyžadujú špeciálny postup. Hlavné príznaky problému: huby na kmeni alebo na koreni (najčastejšie podpňovka obyčajná, trasovka červenkastá, smolokôrnica obyčajná na smreku), suché konáre v korune, výtoky šťavy z kmeňa, opadaná kôra, mŕtve miesta v korune. Pri stromoch s viditeľnými hubami varujeme objednávateľa, že vnútorný stav dreva môže byť horší než vyzerá zvonku, a že počas výrubu sa môžu objaviť ďalšie problémy. Pri starých stromoch (nad 80 rokov) je riziko vnútornej hniloby vyššie.',
      },
      {
        heading: 'Posúdenie okolia (vedenie, prístup, prekážky)',
        body:
          'Okolie stromu rozhoduje o spôsobe výrubu a o cene. Pri obhliadke premeriame vzdialenosť od najbližšej budovy (v metroch), vzdialenosť od najbližšieho vedenia elektriny alebo telekomunikácií, šírku vjazdu pre auto, nosnosť cesty (či utiahne vlečku s drevom), sklon terénu, prítomnosť oplotenia, záhradných stavieb, bazénov, parkovaných áut. Pri stromoch v blízkosti vedenia preveríme, či je vedenie pri zemi (nízke napätie) alebo na stĺpoch (vysoké napätie). Pri vysokom napätí vás informujeme, že je potrebná spolupráca s distribučnou spoločnosťou a že termín výrubu sa môže predĺžiť o 14 dní.',
      },
      {
        heading: 'Konzultácia o spôsobe výrubu',
        body:
          'Po posúdení stromu a okolia spolu prejdeme možnosti. Pri väčšine stromov ide o jeden z troch postupov: klasický voľný pád celého stromu (pri stromoch v lese alebo na veľkom voľnom priestranstve), výrub plošinou alebo autožeriavom (pri stromoch na dostupnom mieste s tvrdou zemou), lanové pílenie zhora nadol (pri stromoch v dvore, nad strechou, pri vedení). Pri každej možnosti vás informujeme o predpokladanom čase, cene a o tom, čo zostane na zemi (množstvo dreva, konárov). Pri nezvyčajných situáciách (strom napadnutý hubou nad vedením) zvyčajne navrhujeme aj odbornú konzultáciu s lesníkom.',
      },
      {
        heading: 'Cenová ponuka a termín',
        body:
          'Na konci obhliadky vám povieme konkrétnu sumu za výrub. Cena je pevná, na základe toho, čo sme videli. Pri rozdiele medzi predpokladaným a skutočným stavom (napríklad keď strom v reáli má viac vnútornej hniloby než vyzeral zvonku) sa cena upraví len po dohode. Termín sa zvyčajne pohybuje od 1 do 4 týždňov, podľa nášho rozpisu a podľa toho, či je potrebná spolupráca s distribučnou spoločnosťou. Pri urgentných prípadoch (strom hrozí pádom na dom alebo na cestu) sa pokúsime byť na mieste v priebehu 1 až 3 dní. Cenovú ponuku dostanete aj písomne emailom, ak chcete.',
      },
    ],
    whatsIncluded: {
      heading: 'Čo je v obhliadke',
      items: [
        'Príchod na miesto v dohodnutom termíne',
        'Posúdenie stavu stromu a jeho okolia',
        'Premeranie výšky, priemeru kmeňa a vzdialeností',
        'Návrh optimálneho postupu výrubu',
        'Konkrétna cenová ponuka v pevnej sume',
        'Možný termín realizácie po dohode',
        'Písomná cenová ponuka emailom (na požiadanie)',
      ],
    },
    materials: {
      heading: 'Výbava na obhliadku',
      body:
        'Pri obhliadke používame jednoduchú výbavu: meracie pásmo 30 metrov pre výšku odhadom a obvod kmeňa, gumové kladivo pre rezonančný test, fotoaparát na zaznamenanie stavu, blok a pero. Pri rizikových stromoch s vedením máme so sebou aj kompas a laserový diaľkomer pre presné premeranie vzdialeností. Pri pochybnostiach o vnútornom stave dreva môžeme použiť navrtaný vrták (Resi F500) na zistenie hĺbky dutiny, ale to už ide o spoplatnenú analýzu, ktorú dohodneme zvlášť. Bežná obhliadka je vizuálna a vždy bezplatná.',
    },
    process: {
      heading: 'Ako to prebieha',
      steps: [
        {
          title: 'Telefonát alebo formulár',
          body: 'Opíšete strom, polohu a problém. Pošlite fotku z dvoch strán, ak môžete.',
        },
        {
          title: 'Dohodnutie termínu',
          body: 'Najčastejšie do troch pracovných dní. V urgentných prípadoch skôr, ak to časovo zvládneme.',
        },
        {
          title: 'Príchod na miesto',
          body: 'Prídeme v dohodnutom čase. Posúdime strom, okolie a prístup pre techniku.',
        },
        {
          title: 'Konzultácia s objednávateľom',
          body: 'Spolu prejdeme možnosti výrubu, prediskutujeme cenu a možný termín.',
        },
        {
          title: 'Cenová ponuka',
          body: 'Na mieste a aj emailom (na požiadanie). Bez záväzku, platí 30 dní.',
        },
      ],
    },
    pricing: {
      heading: 'Cena',
      body:
        'Obhliadka je zadarmo a nezáväzná. Platíte len v prípade, že sa rozhodnete pre samotný výrub. Pri špeciálnych vyšetreniach stromu (rezonančný test s vrtákom, posúdenie statickej stability) cenu dohodneme zvlášť, a tieto vyšetrenia sú spoplatnené. Bežná vizuálna obhliadka, ktorá pokrýva väčšinu prípadov, je vždy bezplatná aj v prípade, že nakoniec spoluprácu nezačneme.',
    },
    faqs: [
      {
        q: 'Koľko trvá obhliadka?',
        a: 'Štandardne 15 až 30 minút. Pri väčšom počte stromov alebo pri zložitých prípadoch (vedenie, ťažký prístup) môže trvať aj hodinu.',
      },
      {
        q: 'Musím byť pri obhliadke prítomný?',
        a: 'Áno, je to ideálne. Pri obhliadke prediskutujeme, čo presne chcete, a vy dostanete cenovú ponuku. Ak nemôžete, dohodneme sa cez telefón na základe fotiek, ale to je menej presné.',
      },
      {
        q: 'Aké stromy obhliadnete?',
        a: 'Obhliadneme každý strom, ktorý sa rozhodnete riešiť. Najčastejšie ide o smreky, borovice, jasene, javory, agáty, brezy, duby. Nezáleží na veku ani na druhu.',
      },
      {
        q: 'Dostanem cenovú ponuku písomne?',
        a: 'Áno, ak chcete. Zvyčajne ju pošleme emailom v ten istý alebo nasledujúci deň. Cenová ponuka platí 30 dní.',
      },
      {
        q: 'Robíte aj obhliadku, ak nakoniec nezavolám výrub?',
        a: 'Áno. Obhliadka je zadarmo a nezáväzná. Nezáleží na tom, či sa rozhodnete pre nás alebo nie.',
      },
      {
        q: 'Ako mám pripraviť strom na obhliadku?',
        a: 'Nijako špeciálne. Stačí, aby bol strom prístupný (nie zarastený neprehľadným kríkom) a aby sme mohli obísť ho z viacerých strán. Ak je strom v lese, dohodneme aspoň približné miesto a ako sa tam dostaneme.',
      },
    ],
    finalCTA: {
      heading: 'Potrebujete posúdiť stav stromu?',
      body: 'Zavolajte alebo napíšte. Prídeme bezplatne, posúdime situáciu a dohodneme ďalšie kroky.',
    },
  },
  'tazba-dreva': {
    slug: 'tazba-dreva',
    metaTitle: 'Ťažba dreva v Žilinskom kraji | Pílenie stromov Orava',
    metaDescription:
      'Bezpečné rezanie a spracovanie stromov v lese, na hraniciach polí a v ťažko prístupných miestach. Námestovo, Trstená, Tvrdošín, Dolný Kubín. Obhliadka zadarmo.',
    breadcrumb: 'Ťažba dreva',
    hero: {
      h1: 'Ťažba dreva v Žilinskom kraji',
      sub: 'Bezpečné rezanie a spracovanie stromov v lese a na hraniciach polí. Odvoz, štiepkovanie alebo nechanie na mieste podľa dohody.',
      image: '/images/service-5-tazba-dreva.webp',
    },
    intro:
      'Ťažba dreva je rezanie a spracovanie väčšieho počtu stromov, najčastejšie na vlastnom lesnom pozemku alebo na okraji poľa. Robíme to pre súkromných vlastníkov lesa, pre poľnohospodárov a pre majiteľov záhradných lesíkov. Pred ťažbou vždy potvrdíme právne náležitosti (vlastníctvo, povolenie, ak je potrebné) a navrhneme optimálny postup.\n\nPôsobíme v Námestove, Trstenej, Tvrdošíne, Dolnom Kubíne a Žiline, ako aj v okolitých obciach po celom Žilinskom kraji.',
    topicalSections: [
      {
        heading: 'Pre koho je ťažba dreva',
        body:
          'Naše služby ťažby dreva sú pre súkromných vlastníkov lesa, poľnohospodárov, majiteľov záhradných lesíkov, samosprávy pri údržbe verejnej zelene. Najčastejšie ide o jednorázové výruby (5 až 50 stromov) na vlastnom pozemku. Pri väčšej ťažbe (nad 100 m³) odporúčame spoluprácu s profesionálnym ťažbárskym podnikom alebo s lesnou správou. My sa špecializujeme na menšie zákazky, kde sa oplatí ručná práca a presnosť. Pri ťažbe na pozemku Lesov SR alebo na pozemku Mestských lesov potrebujeme písomný súhlas správcu. V iných prípadoch (vlastný les) stačí ústna dohoda s vlastníkom, prípadne povolenie obce pri stromoch nad zákonný obvod.',
      },
      {
        heading: 'Plánovanie ťažby (klčovanie, prebierka, výchovný zásah)',
        body:
          'Pred prácou si dohodneme typ ťažby. Hlavné možnosti: klčovanie (úplný výrub všetkých stromov na vyznačenej ploche, najmä pri prerábaní lesa na pole alebo na stavbu), prebierka (výrub vybraných stromov, ktoré sú choré, naklonené alebo bránia rastu zdravým stromom), výchovný zásah (odstránenie tenších stromov, aby zostávajúce dostali viac priestoru a svetla), sanitárny výrub (odstránenie napadnutých stromov, najmä smrekov s podkôrnym hmyzom). Pri každom type ťažby je iný plán pádu, iné spracovanie a iná cena. Pri klčovaní robíme zvyčajne kompletný odvoz aj koreňových pňov.',
      },
      {
        heading: 'Smerový výrub plošinou alebo motorovou pílou',
        body:
          'Pri ťažbe v lese pracujeme zvyčajne motorovou pílou priamo zo zeme. Pri stromoch s priemerom kmeňa nad 50 cm potrebujeme dlhšiu lištu (45 alebo 50 cm). Pri menších stromoch postačí 35 cm lišta. Postup: vyznačenie smeru pádu, podpil (klin tvaru sedla, otvorený smerom k smeru pádu), hlavný rez (z opačnej strany, vodorovne, mierne nad spodným okrajom podpilu, ponechaný pás dreva ako záver). Strom začne klesať na klin, ktorý sa otvára. Pri stromoch v hustom lese, kde okolité stromy bránia priamemu pádu, používame klin alebo navádzacie lano.',
      },
      {
        heading: 'Spracovanie na palivové drevo alebo guľatinu',
        body:
          'Po výrube delíme kmeň na požadované dĺžky. Palivové drevo najčastejšie 33 cm (do bežnej pece), 50 cm (do veľkej pece alebo do kotla), 1 meter (na ďalšie štiepanie). Guľatina (drevo na predaj na pílu) sa narezáva na presné dĺžky podľa odberateľa, najčastejšie 4 metre alebo 5 metrov pre stavebné drevo, alebo 2,5 metra pre rezivo. Pri guľatine je dôležitá kvalita, takže narezávame tak, aby v dlhšom úseku boli najlepšie kusy. Pri palivovom dreve nie je potrebná taká presnosť. Konáre buď zoštiepkujeme, spálime na mieste (ak je to povolené), alebo necháme zložené.',
      },
      {
        heading: 'Odvoz vlečkou a špecializovaným autom',
        body:
          'Po spracovaní drevo odvezieme alebo zložíme na mieste podľa dohody. Pri palivovom dreve nakladáme do vlečky (kapacita 4 až 6 m³) a odvážame k vám domov alebo na sklad. Pri guľatine nakladáme na nákladné auto s hydraulickým ramenom (kapacita 10 až 15 m³) a odvážame na pílu. Odvoz je za príplatok podľa vzdialenosti a množstva. Pri odvoze ku kupcovi guľatiny (ako je píla Tatra Mútne, Bučina Zvolen alebo lokálne píly v Námestove) zvyčajne hradí odvoz kupec. Pri odvoze pre vás (palivové drevo) cenu kalkulujeme zvlášť.',
      },
      {
        heading: 'Ekologické zásady pri ťažbe',
        body:
          'Pri ťažbe dreva dbáme na šetrnosť k okoliu. Hlavné zásady: nepoškodzovanie okolitých stromov pri pádu (smerový výrub), nepoškodzovanie pôdy (ťažká technika len na únosnom teréne), zachovanie biotopu (nevylievame motorový olej do pôdy, ostávame na vyznačenej ploche), úprava terénu po ťažbe (zarovnanie koľají, odstránenie tršin). Pri ťažbe v období hniezdenia vtákov (apríl až júl) sme opatrnejší a vyhýbame sa stromom so známym hniezdom. Pri ťažbe v chránených územiach (CHKO, prírodné rezervácie) je potrebné povolenie Štátnej ochrany prírody. V takých prípadoch vám pomôžeme so spísaním žiadosti.',
      },
      {
        heading: 'Lesnícke a poľnohospodárske služby',
        body:
          'Okrem ťažby dreva ponúkame aj iné lesnícke a poľnohospodárske služby: pílenie krovín a krov, ručné štiepanie palivového dreva (pri menších množstvách do 5 m³), odstránenie pňov mechanicky alebo chemicky, výsadbu stromov (smrek, borovica, javor pre les; lipa, jaseň, javor pre záhradu), prebierku mladých porastov (do 20 rokov), údržbu lesných ciest. Pri kombinovaných zákazkách (ťažba plus odstránenie pňov plus výsadba nového lesa) cenu kalkulujeme paušálne, čo je lacnejšie ako jednotlivé úkony zvlášť. Pri kompletnej rekonštrukcii lesa odporúčame konzultáciu s lesným odborným hospodárom.',
      },
    ],
    whatsIncluded: {
      heading: 'Čo je v cene',
      items: [
        'Obhliadka pozemku a vyznačenie stromov',
        'Cenová ponuka v pevnej sume na m³ alebo na strom',
        'Smerový výrub stromov motorovou pílou',
        'Delenie kmeňa na požadované dĺžky',
        'Spracovanie konárov (štiepkovanie alebo zloženie)',
        'Odvoz vlečkou alebo nákladným autom (za príplatok)',
        'Hrubé upratanie pracovného priestoru po ťažbe',
      ],
    },
    materials: {
      heading: 'Výbava a materiály',
      body:
        'Pri ťažbe dreva pracujeme s motorovými pílami Stihl MS 261 (univerzálna, 4,2 kg), MS 462 (pre veľké stromy, 6 kg), MS 661 (pre kmene nad 80 cm priemeru, 7,4 kg). Husqvarna 562 XP alebo 372 XP ako záložná. Lišty 35 cm, 45 cm a 50 cm. Pohonné hmoty: benzín 95 v zmesi s 2-taktným olejom (Stihl HP Ultra) v pomere 1:50, mazací olej na lištu (Stihl ForestPlus). Ochranné nohavice s vystuženou prednou stranou (Stihl Function Universal), helma Stihl Advance X-Vent s ochranou tváre a sluchu, rukavice Stihl Function. Pri ťažbe v lese máme aj sekeru, klin, hákový hák na manipuláciu s kmeňom.',
    },
    process: {
      heading: 'Ako to prebieha',
      steps: [
        {
          title: 'Telefonát alebo formulár',
          body: 'Opíšete rozsah ťažby (počet stromov, druh dreviny, prístup), polohu pozemku.',
        },
        {
          title: 'Obhliadka pozemku',
          body: 'Prídeme na pozemok, vyznačíme stromy, posúdime prístup, dohodneme termín ťažby.',
        },
        {
          title: 'Cenová ponuka',
          body: 'Pevná suma na m³ alebo na strom. Pri väčšej ťažbe ponuka aj písomne emailom.',
        },
        {
          title: 'Realizácia',
          body: 'Ťažba podľa dohody. Pri väčšom rozsahu rozdelená do viacerých dní.',
        },
        {
          title: 'Spracovanie a odvoz',
          body: 'Drevo narežeme na požadované dĺžky, konáre spracujeme, pozemok po sebe upraceme.',
        },
      ],
    },
    pricing: {
      heading: 'Cena',
      body:
        'Cena za ťažbu sa určuje na m³ alebo na strom, v závislosti od rozsahu. Pri ťažbe palivového dreva (smrek, borovica) sa cena zvyčajne pohybuje od 25 do 40 eur za m³. Pri ťažbe tvrdého dreva (buk, dub, jaseň) od 35 do 55 eur za m³. Pri jednotlivých stromoch v ťažko prístupných miestach kalkulujeme cenu na strom. Cenu vždy presne určíme po obhliadke. Odvoz dreva a štiepkovanie konárov sú samostatne kalkulované služby.',
    },
    faqs: [
      {
        q: 'Potrebujem povolenie na ťažbu vo vlastnom lese?',
        a: 'Pri jednotlivých stromoch s obvodom kmeňa do 80 cm (meraným vo výške 130 cm) na pozemku vlastníka nie je potrebné povolenie. Pri väčších stromoch alebo pri ťažbe väčšieho rozsahu sa odporúča konzultácia s lesným odborným hospodárom alebo s obecným úradom. V chránených územiach platia prísnejšie pravidlá.',
      },
      {
        q: 'Kúpite drevo alebo platím ja za ťažbu?',
        a: 'Záleží od typu dreva. Palivové drevo (smrek, borovica) zvyčajne kúpime alebo s ním ďalej narábame, čo môže pokryť časť alebo celú cenu za ťažbu. Pri guľatine (kvalitné drevo na pílu) cenu dohodneme zvlášť. Pri ťažbe ako službe (vy zostávate vlastníkom dreva) platíte za ťažbu vy.',
      },
      {
        q: 'Pracujete v zime, keď je sneh?',
        a: 'Áno, zimné mesiace sú v skutočnosti najlepším obdobím na ťažbu dreva. Drevo je suchšie, zem je tvrdá (menej koľají od techniky), strom je v vegetatívnom pokoji.',
      },
      {
        q: 'Robíte ťažbu na pozemkoch Lesov SR alebo Mestských lesov?',
        a: 'Áno, po dohode so správcom. Pri verejnom obstarávaní podávame ponuku, pri menších zákazkách (do 5000 eur) zvyčajne stačí priama objednávka.',
      },
      {
        q: 'Vystavujete faktúru? Pracujete pre firmy?',
        a: 'Áno, pracujeme s SZČO aj s firmami. Vystavujeme faktúry. Pri väčších zákazkách dohodneme zálohu (30 % z ceny) a doplatok po dokončení.',
      },
      {
        q: 'Spracujete pňové korene po výrube?',
        a: 'Áno, pne odstránime mechanickým frézovaním alebo vykopaním. Pri stromoch s plytkým koreňovým systémom (smrek, borovica) je vykopanie ľahšie. Pri stromoch s hlbokým koreňom (dub, agát) odporúčame frézovanie.',
      },
    ],
    finalCTA: {
      heading: 'Plánujete ťažbu vo vlastnom lese?',
      body: 'Zavolajte alebo napíšte. Prídeme sa pozrieť na pozemok, dohodneme rozsah a cenu. Obhliadka zadarmo.',
    },
  },
};

export const galleryImages: { src: string; alt: string }[] = [
  { src: '/images/gallery-1.webp', alt: 'Realizácia výrubu stromu — Pílenie stromov Orava' },
  { src: '/images/gallery-2.webp', alt: 'Lanové pílenie v náročnom teréne' },
  { src: '/images/gallery-3.webp', alt: 'Rizikový výrub v blízkosti budovy' },
  { src: '/images/gallery-4.webp', alt: 'Práca arboristu v korune stromu' },
  { src: '/images/gallery-5.webp', alt: 'Pílenie stromov v ťažko prístupnom mieste' },
  { src: '/images/gallery-6.webp', alt: 'Ťažba dreva — výsledok prác' },
];
