/* ==========================================================================
   BASILICO BISTRO — data.js
   Az oldal teljes tartalma egyetlen helyen. Ez a "mag": az admin felület
   ezt tölti be először, majd a localStorage-ban tárolt módosításokat
   fésüli rá. Ha az oldalt átadod egy ügyfélnek, jellemzően csak ezt a
   fájlt kell átírni.
   ========================================================================== */

const DATA = {

  /* --- Étterem alapadatok ------------------------------------------------ */
  brand: {
    name: 'Basilico Bistro',
    tagline: 'Kőkemencés nápolyi pizza, magyar szívvel',
    claim: '48 órán át kelesztett tészta. Kizárólag olasz alapanyag. Nulla kompromisszum.',
    address: 'Budapest, Kőfaragó utca 15.',
    district: 'VIII. kerület · Palotanegyed',
    phone: '+36 1 234 5678',
    phoneHref: '+3612345678',
    email: 'foglalas@basilicobistro.hu',
    founded: 2020,
    seats: 64,
    ovenTemp: 485,
    rating: 4.9,
    ratingCount: 1284,
    social: { fb: '#', ig: '#', tiktok: '#' },
    features: [
      { icon: 'wifi', label: 'Ingyenes wifi' },
      { icon: 'park', label: 'Parkolás a ház előtt' },
      { icon: 'pet', label: 'Kutyabarát terasz' },
      { icon: 'baby', label: 'Etetőszék, pelenkázó' },
      { icon: 'leaf', label: 'Vegán opciók' },
      { icon: 'fire', label: 'Nyitott kemence' }
    ]
  },

  /* --- Nyitvatartás ------------------------------------------------------
     0 = vasárnap … 6 = szombat. `null` = zárva.
     A "villogó pötty" ebből számol élő státuszt.                            */
  hours: {
    0: { open: '12:00', close: '21:00' },
    1: null,
    2: { open: '11:30', close: '22:00' },
    3: { open: '11:30', close: '22:00' },
    4: { open: '11:30', close: '22:00' },
    5: { open: '11:30', close: '23:30' },
    6: { open: '12:00', close: '23:30' }
  },
  dayNames: ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'],
  dayShort: ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'],

  /* Kivételes napok (ünnep, magánrendezvény) */
  exceptions: [
    { date: '2026-08-20', closed: true, note: 'Államalapítás – zárva tartunk' },
    { date: '2026-12-24', closed: true, note: 'Szenteste – zárva' }
  ],

  /* --- Valódi fotók ------------------------------------------------------
     Alapból minden illusztráció vektorosan, futásidőben készül (art.js).
     Ha van valódi fotód, nem kell egyesével beírni: tedd a képeket az
     `assets/img/` mappába az étel azonosítójával (pl. `p-margherita.jpg`),
     majd kapcsold be ezt lent vagy az admin → Beállítások oldalon.

     A fájlnév = a tétel `id` mezője. Ami hiányzik, ott automatikusan
     visszaáll a rajzolt illusztráció — nem lesz tört kép sehol.          */
  photos: {
    enabled: false,
    base:    'assets/img/',
    ext:     '.jpg',
    galleryBase: 'assets/img/galeria/'
  },

  /* --- Kategóriák -------------------------------------------------------- */
  categories: [
    { id: 'pizza',   name: 'Pizzák',      note: '32 cm · kőkemencében sütve' },
    { id: 'special', name: 'Signature',   note: 'A séf saját receptjei' },
    { id: 'pasta',   name: 'Tészták',     note: 'Friss, házi durumtészta' },
    { id: 'elotel',  name: 'Előételek',   note: 'Kis falatok kezdésnek' },
    { id: 'salata',  name: 'Saláták',     note: 'Piaci alapanyagból' },
    { id: 'desszert',name: 'Desszertek',  note: 'Minden nap frissen' },
    { id: 'ital',    name: 'Italok',      note: 'Bor, sör, kávé, limonádé' }
  ],

  /* --- Étlap -------------------------------------------------------------
     toppings → art.js feltétkulcsok (a rajzoláshoz)
     price    → 32 cm-es ár Ft-ban;  price40 → 40 cm-es ár
     heat     → csípősség 0-3;  tags → veg | hot | new | top | gluten
     photo    → ha megadsz egy képURL-t, az illusztráció helyett az jelenik meg */
  menu: [
    /* ---------------- PIZZÁK ---------------- */
    { id: 'p-margherita', cat: 'pizza', name: 'Margherita',
      ings: 'San Marzano paradicsomszósz, fior di latte, friss bazsalikom, extra szűz olívaolaj',
      toppings: ['mozzarella', 'bazsalikom'], base: 'paradicsom',
      price: 3290, price40: 4390, tags: ['veg', 'top'], heat: 0, kcal: 780,
      allergens: ['G', 'T'], desc: 'A klasszikus. Három alapanyag, nulla rejtekhely – ezen mérünk le mindent.' },

    { id: 'p-marinara', cat: 'pizza', name: 'Marinara',
      ings: 'Paradicsomszósz, fokhagyma, oregánó, olívaolaj (sajt nélkül)',
      toppings: ['fokhagyma'], base: 'paradicsom',
      price: 2890, price40: 3890, tags: ['veg'], heat: 0, kcal: 620,
      allergens: ['G'], desc: 'A legrégebbi nápolyi recept 1734-ből. Vegán, és sokkal jobb, mint hangzik.' },

    { id: 'p-diavola', cat: 'pizza', name: 'Diavola',
      ings: 'Paradicsomszósz, mozzarella, csípős szalámi, calabriai chili, oregánó',
      toppings: ['szalami', 'csili'], base: 'paradicsom',
      price: 4290, price40: 5490, tags: ['hot', 'top'], heat: 3, kcal: 980,
      allergens: ['G', 'T'], desc: 'Nem finomkodik. A calabriai chilit magunk pácoljuk olívaolajban.' },

    { id: 'p-quattro', cat: 'pizza', name: 'Quattro Formaggi',
      ings: 'Tejszínes alap, mozzarella, gorgonzola, parmezán, kecskesajt, méz',
      toppings: ['mozzarella', 'gorgonzola', 'parmezan', 'kecskesajt'], base: 'feher',
      price: 4590, price40: 5790, tags: ['veg'], heat: 0, kcal: 1120,
      allergens: ['G', 'T'], desc: 'Négy sajt, egy csepp akácméz a végén. Ez a csavar.' },

    { id: 'p-prosciutto', cat: 'pizza', name: 'Prosciutto e Rucola',
      ings: 'Paradicsomszósz, mozzarella, 18 hónapos Parma sonka, rukkola, parmezánforgács',
      toppings: ['prosciutto', 'rukkola', 'parmezan'], base: 'paradicsom',
      price: 4890, price40: 6190, tags: ['top'], heat: 0, kcal: 940,
      allergens: ['G', 'T'], desc: 'A sonka sütés UTÁN kerül rá. Sosem előtte. Ez nem vita tárgya.' },

    { id: 'p-capricciosa', cat: 'pizza', name: 'Capricciosa',
      ings: 'Paradicsomszósz, mozzarella, sonka, gomba, articsóka, olívabogyó, tojás',
      toppings: ['sonka', 'gomba', 'articsoka', 'olivabogyo', 'tojas'], base: 'paradicsom',
      price: 4490, price40: 5690, tags: [], heat: 0, kcal: 1010,
      allergens: ['G', 'T', 'to'], desc: 'A "mindent bele" pizza, ahogy Rómában csinálják.' },

    { id: 'p-funghi', cat: 'pizza', name: 'Funghi Porcini',
      ings: 'Tejszínes alap, mozzarella, vargánya, csiperke, kakukkfű, szarvasgombaolaj',
      toppings: ['gomba', 'trufla', 'mozzarella'], base: 'feher',
      price: 4790, price40: 5990, tags: ['veg', 'new'], heat: 0, kcal: 890,
      allergens: ['G', 'T'], desc: 'Erdei illat. Ősszel friss vargányával, azon kívül szárítottal.' },

    { id: 'p-vegetariana', cat: 'pizza', name: 'Orto Vegetariana',
      ings: 'Paradicsomszósz, mozzarella, grillezett cukkini, padlizsán, paprika, koktélparadicsom, bazsalikom',
      toppings: ['paprika', 'paradicsom', 'bazsalikom', 'hagyma'], base: 'paradicsom',
      price: 4190, price40: 5290, tags: ['veg'], heat: 0, kcal: 760,
      allergens: ['G', 'T'], desc: 'A zöldségeket grillen karamellizáljuk, nem nyersen dobjuk rá.' },

    { id: 'p-tonno', cat: 'pizza', name: 'Tonno e Cipolla',
      ings: 'Paradicsomszósz, mozzarella, tonhal, lilahagyma, kapribogyó, citromhéj',
      toppings: ['tonhal', 'hagyma', 'kapribogyo'], base: 'paradicsom',
      price: 4390, price40: 5590, tags: [], heat: 0, kcal: 850,
      allergens: ['G', 'T', 'H'], desc: 'Olívaolajos tonhal, nem vizes konzerv. Érezni a különbséget.' },

    { id: 'p-hawaii', cat: 'pizza', name: 'Hawaii (igen, van)',
      ings: 'Paradicsomszósz, mozzarella, füstölt sonka, grillezett ananász, kevés chili',
      toppings: ['sonka', 'ananasz', 'csili'], base: 'paradicsom',
      price: 4190, price40: 5290, tags: [], heat: 1, kcal: 920,
      allergens: ['G', 'T'], desc: 'Tudjuk, megosztó. Grillezzük az ananászt, és ettől működik.' },

    { id: 'p-quattro-stagioni', cat: 'pizza', name: 'Quattro Stagioni',
      ings: 'Paradicsomszósz, mozzarella, négy negyed: sonka, gomba, articsóka, olívabogyó',
      toppings: ['sonka', 'gomba', 'articsoka', 'olivabogyo'], base: 'paradicsom',
      price: 4490, price40: 5690, tags: [], heat: 0, kcal: 960,
      allergens: ['G', 'T'], desc: 'Négy évszak, négy negyed. Rendezett káosz.' },

    { id: 'p-salsiccia', cat: 'pizza', name: 'Salsiccia e Friarielli',
      ings: 'Fehér alap, mozzarella, olasz kolbász, nápolyi brokkolirépa, fokhagyma, chili',
      toppings: ['kolbasz', 'rukkola', 'csili'], base: 'feher',
      price: 4790, price40: 5990, tags: ['hot', 'new'], heat: 2, kcal: 1040,
      allergens: ['G', 'T'], desc: 'Nápoly utcai kedvence. Enyhén kesernyés zöld + zsíros kolbász.' },

    { id: 'p-bufala', cat: 'pizza', name: 'Bufala DOP',
      ings: 'Paradicsomszósz, campaniai bivalymozzarella DOP, bazsalikom, olívaolaj',
      toppings: ['mozzarella', 'bazsalikom'], base: 'paradicsom',
      price: 4990, price40: 6290, tags: ['veg', 'top'], heat: 0, kcal: 810,
      allergens: ['G', 'T'], desc: 'Hetente kétszer érkezik Campaniából. Ha elfogy, elfogy.' },

    { id: 'p-frutti', cat: 'pizza', name: 'Frutti di Mare',
      ings: 'Paradicsomszósz, garnélarák, kagyló, tintahal, fokhagyma, petrezselyem, citrom',
      toppings: ['garnela', 'fokhagyma'], base: 'paradicsom',
      price: 5490, price40: 6790, tags: ['new'], heat: 0, kcal: 780,
      allergens: ['G', 'R', 'P'], desc: 'Sajt nélkül, ahogy a tengerparton. Péntek–szombat, amíg tart.' },

    { id: 'p-patate', cat: 'pizza', name: 'Patate e Rosmarino',
      ings: 'Fehér alap, mozzarella, vékonyra szelt burgonya, rozmaring, tengeri só, olívaolaj',
      toppings: ['burgonya', 'mozzarella'], base: 'feher',
      price: 3990, price40: 4990, tags: ['veg'], heat: 0, kcal: 870,
      allergens: ['G', 'T'], desc: 'Szénhidrát a szénhidráton. Nem kérünk elnézést érte.' },

    { id: 'p-vegana', cat: 'pizza', name: 'Verde Vegana',
      ings: 'Pesto alap, növényi mozzarella, grillezett cukkini, pisztácia, rukkola, citrom',
      toppings: ['pisztacia', 'rukkola', 'paprika'], base: 'pesto',
      price: 4390, price40: 5490, tags: ['veg', 'new'], heat: 0, kcal: 720,
      allergens: ['G', 'D'], desc: '100% növényi, és nem "vegán ízű". Egyszerűen jó.' },

    { id: 'p-nduja', cat: 'pizza', name: "'Nduja Inferno",
      ings: "Paradicsomszósz, mozzarella, calabriai 'nduja, hagymalekvár, chiliolaj, méz",
      toppings: ['szalami', 'csili', 'hagyma'], base: 'paradicsom',
      price: 4890, price40: 6090, tags: ['hot', 'new'], heat: 3, kcal: 1080,
      allergens: ['G', 'T'], desc: 'Édes–csípős–zsíros háromszög. A méz nem véletlen: kell.' },

    { id: 'p-bianca', cat: 'pizza', name: 'Bianca Tartufo',
      ings: 'Tejszínes alap, fior di latte, szarvasgomba, tojássárgája, parmezán, feketebors',
      toppings: ['trufla', 'tojas', 'parmezan'], base: 'feher',
      price: 5690, price40: 6990, tags: ['veg', 'top'], heat: 0, kcal: 1010,
      allergens: ['G', 'T', 'to'], desc: 'A ház luxusa. A tojássárgáját az asztalnál törjük fel.' },

    /* ---------------- SIGNATURE ---------------- */
    { id: 's-basilico', cat: 'special', name: 'La Basilico',
      ings: 'Pesto alap, bivalymozzarella, koktélparadicsom, pisztácia, bazsalikomolaj, parmezánhab',
      toppings: ['mozzarella', 'paradicsom', 'pisztacia', 'bazsalikom'], base: 'pesto',
      price: 5290, price40: 6490, tags: ['veg', 'top', 'new'], heat: 0, kcal: 950,
      allergens: ['G', 'T', 'D'], desc: 'A névadó. Öt éve fejlesztjük, és még mindig csiszoljuk.' },

    { id: 's-porcini-nduja', cat: 'special', name: 'Kemence Kettős',
      ings: "Fél 'Nduja Inferno, fél Funghi Porcini – egy tésztán",
      toppings: ['szalami', 'gomba', 'csili', 'trufla'], base: 'paradicsom',
      price: 5190, price40: 6390, tags: ['hot'], heat: 2, kcal: 1030,
      allergens: ['G', 'T'], desc: 'Nem tudsz dönteni? Ne dönts.' },

    { id: 's-crocchetta', cat: 'special', name: 'Crocchetta Pizza',
      ings: 'Fehér alap, füstölt scamorza, ropogós burgonyakrokett, bacon, snidling, tejfölhab',
      toppings: ['burgonya', 'bacon', 'mozzarella'], base: 'feher',
      price: 4990, price40: 6190, tags: ['top'], heat: 0, kcal: 1180,
      allergens: ['G', 'T'], desc: 'Nem hagyományos. Nem is akar az lenni. Vasárnap a legkelendőbb.' },

    { id: 's-dolce', cat: 'special', name: 'Dolce Nutella & Mascarpone',
      ings: 'Édes tészta, mogyorókrém, mascarpone, pirított mogyoró, porcukor',
      toppings: ['pisztacia'], base: 'feher',
      price: 3890, price40: 4890, tags: ['veg'], heat: 0, kcal: 1240,
      allergens: ['G', 'T', 'D'], desc: 'Desszertpizza két-három főre. Kérj hozzá egy eszpresszót.' },

    /* ---------------- TÉSZTÁK ---------------- */
    { id: 't-carbonara', cat: 'pasta', name: 'Spaghetti Carbonara',
      ings: 'Guanciale, tojássárgája, pecorino romano, feketebors — tejszín nélkül',
      toppings: ['bacon', 'tojas', 'parmezan'], base: 'feher',
      price: 4290, tags: ['top'], heat: 0, kcal: 890,
      allergens: ['G', 'T', 'to'], desc: 'Tejszín nincs benne. Soha nem is volt. Kérdezz rá bátran.' },

    { id: 't-cacio', cat: 'pasta', name: 'Cacio e Pepe',
      ings: 'Tonnarelli, pecorino romano, frissen tört feketebors, tésztafőző lé',
      toppings: ['parmezan'], base: 'feher',
      price: 3790, tags: ['veg'], heat: 1, kcal: 760,
      allergens: ['G', 'T'], desc: 'Három hozzávaló. A legnehezebb tészta a világon.' },

    { id: 't-ragu', cat: 'pasta', name: 'Tagliatelle al Ragù',
      ings: '6 órán át főtt marharagu, sárgarépa, zeller, vörösbor, parmezán',
      toppings: ['sonka', 'parmezan'], base: 'paradicsom',
      price: 4590, tags: [], heat: 0, kcal: 940,
      allergens: ['G', 'T'], desc: 'Bolognai, ahogy Bolognában. Nem "spagetti bolognese".' },

    { id: 't-arrabbiata', cat: 'pasta', name: 'Penne all’Arrabbiata',
      ings: 'San Marzano paradicsom, fokhagyma, calabriai chili, petrezselyem',
      toppings: ['paradicsom', 'csili', 'fokhagyma'], base: 'paradicsom',
      price: 3490, tags: ['veg', 'hot'], heat: 2, kcal: 690,
      allergens: ['G'], desc: 'Vegán alapból. "Dühös" – és tényleg az.' },

    { id: 't-lasagne', cat: 'pasta', name: 'Lasagne della Nonna',
      ings: 'Rétegelt házi tészta, marharagu, besamel, parmezán',
      toppings: ['sonka', 'mozzarella'], base: 'paradicsom',
      price: 4390, tags: ['top'], heat: 0, kcal: 1020,
      allergens: ['G', 'T', 'to'], desc: 'A recept egy nápolyi nagymamáé. Nem alkuszunk.' },

    { id: 't-gnocchi', cat: 'pasta', name: 'Gnocchi Gorgonzola',
      ings: 'Házi burgonyagnocchi, gorgonzola krém, dió, zsálya',
      toppings: ['gorgonzola', 'burgonya'], base: 'feher',
      price: 4190, tags: ['veg'], heat: 0, kcal: 880,
      allergens: ['G', 'T', 'D'], desc: 'Puha, mint egy párna. Kedd a gnocchi napja Nápolyban.' },

    /* ---------------- ELŐÉTELEK ---------------- */
    { id: 'e-bruschetta', cat: 'elotel', name: 'Bruschetta Classica (4 db)',
      ings: 'Pirított kovászos kenyér, koktélparadicsom, fokhagyma, bazsalikom, olívaolaj',
      toppings: ['paradicsom', 'bazsalikom'], base: 'paradicsom',
      price: 2290, tags: ['veg'], heat: 0, kcal: 380,
      allergens: ['G'], desc: 'A saját kovászos kenyerünkből. Vegán.' },

    { id: 'e-arancini', cat: 'elotel', name: 'Arancini (3 db)',
      ings: 'Rántott rizsgolyó ragúval és mozzarellával, paradicsomszósszal',
      toppings: ['mozzarella'], base: 'paradicsom',
      price: 2690, tags: ['top'], heat: 0, kcal: 520,
      allergens: ['G', 'T', 'to'], desc: 'Szicíliai utcai klasszikus. Belül olvad.' },

    { id: 'e-burrata', cat: 'elotel', name: 'Burrata & Datterino',
      ings: 'Pugliai burrata, datterino paradicsom, bazsalikom, olívaolaj, tengeri só',
      toppings: ['mozzarella', 'paradicsom', 'bazsalikom'], base: 'feher',
      price: 3690, tags: ['veg', 'top'], heat: 0, kcal: 460,
      allergens: ['T'], desc: 'Vágd fel, és folyjon szét. Ez a lényeg.' },

    { id: 'e-tagliere', cat: 'elotel', name: 'Tagliere Misto (2 főre)',
      ings: 'Parma sonka, szalámi, pecorino, gorgonzola, olívabogyó, grissini, lekvár',
      toppings: ['prosciutto', 'olivabogyo', 'gorgonzola'], base: 'feher',
      price: 5290, tags: [], heat: 0, kcal: 780,
      allergens: ['G', 'T', 'D'], desc: 'Egy üveg bor kötelező tartozéka.' },

    { id: 'e-polpette', cat: 'elotel', name: 'Polpette al Sugo (5 db)',
      ings: 'Marha-sertés húsgombóc paradicsomszószban, parmezán, bazsalikom',
      toppings: ['sonka', 'paradicsom'], base: 'paradicsom',
      price: 2890, tags: [], heat: 0, kcal: 610,
      allergens: ['G', 'T', 'to'], desc: 'Kérj hozzá kenyeret. A szószt nem hagyod ott.' },

    { id: 'e-fritto', cat: 'elotel', name: 'Frittatine Napoletane (2 db)',
      ings: 'Rántott tésztatorta besamellel, borsóval, sonkával',
      toppings: ['sonka'], base: 'feher',
      price: 2490, tags: ['new'], heat: 0, kcal: 640,
      allergens: ['G', 'T'], desc: 'A nápolyi utcák titkos fegyvere. Ritkán kapni Budapesten.' },

    /* ---------------- SALÁTÁK ---------------- */
    { id: 'sa-caprese', cat: 'salata', name: 'Caprese',
      ings: 'Bivalymozzarella, paradicsom, bazsalikom, olívaolaj, balzsamecet',
      toppings: ['mozzarella', 'paradicsom', 'bazsalikom'], base: 'feher',
      price: 2990, tags: ['veg'], heat: 0, kcal: 340,
      allergens: ['T'], desc: 'Az olasz zászló egy tányéron.' },

    { id: 'sa-cesar', cat: 'salata', name: 'Cézár Grillcsirkével',
      ings: 'Római saláta, grillcsirke, parmezán, krutonok, cézár öntet',
      toppings: ['csirke', 'parmezan'], base: 'feher',
      price: 3690, tags: ['top'], heat: 0, kcal: 520,
      allergens: ['G', 'T', 'to', 'H'], desc: 'Az öntetet mi keverjük, nem üvegből jön.' },

    { id: 'sa-rucola', cat: 'salata', name: 'Rukkola & Parma',
      ings: 'Rukkola, Parma sonka, parmezánforgács, pinjemag, balzsamkrém',
      toppings: ['rukkola', 'prosciutto', 'parmezan'], base: 'feher',
      price: 3890, tags: [], heat: 0, kcal: 410,
      allergens: ['T', 'D'], desc: 'Könnyű, de nem sovány. Nyáron a kedvenc.' },

    { id: 'sa-panzanella', cat: 'salata', name: 'Panzanella',
      ings: 'Kovászos kenyér, paradicsom, uborka, lilahagyma, bazsalikom, olívaolaj',
      toppings: ['paradicsom', 'hagyma', 'bazsalikom'], base: 'paradicsom',
      price: 2790, tags: ['veg', 'new'], heat: 0, kcal: 380,
      allergens: ['G'], desc: 'Toszkán kenyérsaláta. Vegán, és meglepően laktató.' },

    /* ---------------- DESSZERTEK ---------------- */
    { id: 'd-tiramisu', cat: 'desszert', name: 'Tiramisù della Casa',
      ings: 'Mascarpone, eszpresszó, savoiardi, kakaó, egy csepp marsala',
      toppings: [], base: 'feher',
      price: 2290, tags: ['top', 'veg'], heat: 0, kcal: 480,
      allergens: ['G', 'T', 'to'], desc: 'Minden reggel frissen. Délutánra gyakran elfogy.' },

    { id: 'd-pannacotta', cat: 'desszert', name: 'Panna Cotta Erdei Gyümölccsel',
      ings: 'Vaníliás tejszínkrém, erdei gyümölcs ragu, menta',
      toppings: [], base: 'feher',
      price: 1990, tags: ['veg'], heat: 0, kcal: 390,
      allergens: ['T'], desc: 'Épp annyira remeg, amennyire kell.' },

    { id: 'd-cannoli', cat: 'desszert', name: 'Cannoli Siciliani (2 db)',
      ings: 'Ropogós tekercs, ricotta krém, csokoládé, pisztácia, kandírozott narancs',
      toppings: [], base: 'feher',
      price: 2190, tags: ['veg'], heat: 0, kcal: 520,
      allergens: ['G', 'T', 'D'], desc: 'Rendeléskor töltjük meg, hogy ropogós maradjon.' },

    { id: 'd-gelato', cat: 'desszert', name: 'Házi Gelato (3 gombóc)',
      ings: 'Napi ízek: pisztácia, sós karamell, málna, stracciatella',
      toppings: [], base: 'feher',
      price: 1890, tags: ['veg'], heat: 0, kcal: 330,
      allergens: ['T', 'D'], desc: 'Kérdezd a mai ízeket – naponta változnak.' },

    { id: 'd-affogato', cat: 'desszert', name: 'Affogato al Caffè',
      ings: 'Vaníliafagylalt forró eszpresszóval leöntve',
      toppings: [], base: 'feher',
      price: 1690, tags: ['veg'], heat: 0, kcal: 240,
      allergens: ['T'], desc: 'Desszert és kávé egyben. A legelegánsabb lezárás.' },

    /* ---------------- ITALOK ---------------- */
    { id: 'i-chianti', cat: 'ital', name: 'Chianti Classico DOCG (üveg)',
      ings: 'Toszkána · Sangiovese · 0,75 l', toppings: [], base: 'feher',
      price: 8900, tags: ['top'], heat: 0, kcal: 0, allergens: ['S'], desc: 'A ház vörösbora. Pohárral 1990 Ft.' },
    { id: 'i-lambrusco', cat: 'ital', name: 'Lambrusco (pohár)',
      ings: 'Emilia-Romagna · gyöngyöző vörös · 1,5 dl', toppings: [], base: 'feher',
      price: 1690, tags: [], heat: 0, kcal: 0, allergens: ['S'], desc: 'Hűtve, pizzához. Ne szégyelld.' },
    { id: 'i-aperol', cat: 'ital', name: 'Aperol Spritz',
      ings: 'Aperol, prosecco, szóda, narancs', toppings: [], base: 'feher',
      price: 2290, tags: ['top'], heat: 0, kcal: 180, allergens: ['S'], desc: 'A terasz hivatalos itala.' },
    { id: 'i-negroni', cat: 'ital', name: 'Negroni',
      ings: 'Gin, Campari, vörös vermut, narancshéj', toppings: [], base: 'feher',
      price: 2590, tags: [], heat: 0, kcal: 210, allergens: [], desc: 'Egy az egyhez az egyhez. Ennyi.' },
    { id: 'i-birra', cat: 'ital', name: 'Peroni Nastro Azzurro (0,33)',
      ings: 'Olasz lager, csapolt', toppings: [], base: 'feher',
      price: 1290, tags: [], heat: 0, kcal: 140, allergens: ['G'], desc: 'Jéghideg. Mindig.' },
    { id: 'i-craft', cat: 'ital', name: 'Kézműves IPA (0,4)',
      ings: 'Magyar főzde, heti váltásban', toppings: [], base: 'feher',
      price: 1790, tags: ['new'], heat: 0, kcal: 190, allergens: ['G'], desc: 'Kérdezd a pultost, mi csapon a héten.' },
    { id: 'i-limonata', cat: 'ital', name: 'Házi Limonádé',
      ings: 'Szicíliai citrom, bazsalikom vagy málna, szóda', toppings: [], base: 'feher',
      price: 1390, tags: ['veg', 'top'], heat: 0, kcal: 110, allergens: [], desc: 'Nem szirupból. Frissen facsart.' },
    { id: 'i-espresso', cat: 'ital', name: 'Eszpresszó',
      ings: '100% arabica, olasz pörkölés', toppings: [], base: 'feher',
      price: 690, tags: [], heat: 0, kcal: 5, allergens: [], desc: 'Duplán +300 Ft.' },
    { id: 'i-cappuccino', cat: 'ital', name: 'Cappuccino',
      ings: 'Eszpresszó, gőzölt tej, latte art', toppings: [], base: 'feher',
      price: 990, tags: [], heat: 0, kcal: 120, allergens: ['T'], desc: 'Olaszországban 11 óra után nem rendelnéd. Itt nyugodtan.' },
    { id: 'i-san', cat: 'ital', name: 'San Pellegrino (0,5)',
      ings: 'Szénsavas ásványvíz', toppings: [], base: 'feher',
      price: 890, tags: [], heat: 0, kcal: 0, allergens: [], desc: 'Buborékokkal.' }
  ],

  /* --- Allergénjelölések ------------------------------------------------- */
  allergenMap: {
    G:  'Glutén',
    T:  'Tej',
    to: 'Tojás',
    D:  'Diófélék',
    H:  'Hal',
    R:  'Rákfélék',
    P:  'Puhatestűek',
    S:  'Szulfit'
  },

  /* --- Pizzaépítő alapanyagai -------------------------------------------- */
  builder: {
    basePrice: 2790,
    bases: [
      { id: 'paradicsom', name: 'Paradicsomszósz', price: 0 },
      { id: 'feher',      name: 'Fehér (tejszínes)', price: 200 },
      { id: 'pesto',      name: 'Bazsalikom pesto', price: 400 },
      { id: 'tejfol',     name: 'Tejfölös alap', price: 200 }
    ],
    sizes: [
      { id: 32, name: '32 cm', mult: 1 },
      { id: 40, name: '40 cm', mult: 1.28 },
      { id: 50, name: '50 cm (NY style)', mult: 1.62 }
    ],
    doughs: [
      { id: 'classic', name: 'Klasszikus 48 órás', price: 0 },
      { id: 'whole',   name: 'Teljes kiőrlésű', price: 300 },
      { id: 'gluten',  name: 'Gluténmentes', price: 690 },
      { id: 'thick',   name: 'Vastag, buborékos perem', price: 400 }
    ],
    items: [
      { id: 'mozzarella', name: 'Mozzarella',   price: 400, color: '#FBF6E9' },
      { id: 'szalami',    name: 'Csípős szalámi', price: 590, color: '#C4362B' },
      { id: 'sonka',      name: 'Sonka',        price: 550, color: '#E8918C' },
      { id: 'prosciutto', name: 'Parma sonka',  price: 890, color: '#E890A0' },
      { id: 'bacon',      name: 'Bacon',        price: 550, color: '#C96A57' },
      { id: 'kolbasz',    name: 'Olasz kolbász', price: 620, color: '#9E3B2A' },
      { id: 'csirke',     name: 'Grillcsirke',  price: 590, color: '#D9B27A' },
      { id: 'gomba',      name: 'Gomba',        price: 390, color: '#D8C4A6' },
      { id: 'paprika',    name: 'Paprika',      price: 350, color: '#3FA24C' },
      { id: 'hagyma',     name: 'Lilahagyma',   price: 300, color: '#D9CFE4' },
      { id: 'paradicsom', name: 'Koktélparadicsom', price: 390, color: '#DE4A3B' },
      { id: 'olivabogyo', name: 'Olívabogyó',   price: 390, color: '#2E2A33' },
      { id: 'kukorica',   name: 'Kukorica',     price: 320, color: '#F2C438' },
      { id: 'ananasz',    name: 'Ananász',      price: 390, color: '#F0CE55' },
      { id: 'articsoka',  name: 'Articsóka',    price: 490, color: '#6E9464' },
      { id: 'rukkola',    name: 'Rukkola',      price: 390, color: '#5BAE60' },
      { id: 'bazsalikom', name: 'Friss bazsalikom', price: 250, color: '#4FA45E' },
      { id: 'gorgonzola', name: 'Gorgonzola',   price: 590, color: '#EDE7D6' },
      { id: 'parmezan',   name: 'Parmezán',     price: 490, color: '#F3E4BE' },
      { id: 'kecskesajt', name: 'Kecskesajt',   price: 590, color: '#FCF3E0' },
      { id: 'feta',       name: 'Feta',         price: 490, color: '#FFFBF0' },
      { id: 'tojas',      name: 'Tojás',        price: 350, color: '#FFFDF2' },
      { id: 'tonhal',     name: 'Tonhal',       price: 690, color: '#D8A98F' },
      { id: 'garnela',    name: 'Garnélarák',   price: 990, color: '#F08A6E' },
      { id: 'csili',      name: 'Calabriai chili', price: 290, color: '#E33B22' },
      { id: 'fokhagyma',  name: 'Fokhagyma',    price: 200, color: '#F4EEDD' },
      { id: 'kapribogyo', name: 'Kapribogyó',   price: 390, color: '#5E7A46' },
      { id: 'burgonya',   name: 'Burgonya',     price: 350, color: '#E6CE9C' },
      { id: 'pisztacia',  name: 'Pisztácia',    price: 690, color: '#8FB94F' },
      { id: 'trufla',     name: 'Szarvasgomba', price: 1290, color: '#3B3229' }
    ]
  },

  /* --- Galéria ----------------------------------------------------------- */
  gallery: [
    { id: 'g1',  scene: 'kemence',  cat: 'konyha',   title: 'A kemence',            text: '485 °C, tölgyfa, 90 másodperc.' },
    { id: 'g2',  scene: 'szelet',   cat: 'etelek',   title: 'A szelet',             text: 'Amiért mindenki visszajön.' },
    { id: 'g3',  scene: 'teszta',   cat: 'konyha',   title: '48 órás tészta',       text: 'Lassú kelesztés, könnyű emésztés.' },
    { id: 'g4',  scene: 'asztal',   cat: 'etelek',   title: 'Asztal kettőnek',      text: 'Két pizza, egy üveg Chianti.' },
    { id: 'g5',  scene: 'belso',    cat: 'hely',     title: 'Este a bisztróban',    text: 'Meleg fények, 64 hely.' },
    { id: 'g6',  scene: 'terasz',   cat: 'hely',     title: 'Nyári terasz',         text: 'Füzérfény, kutyabarát.' },
    { id: 'g7',  scene: 'bor',      cat: 'italok',   title: 'Ház bora',             text: 'Toszkán Sangiovese.' },
    { id: 'g8',  scene: 'fuszer',   cat: 'konyha',   title: 'Saját bazsalikom',     text: 'A teraszon nő, a pizzán végzi.' },
    { id: 'g9',  scene: 'desszert', cat: 'etelek',   title: 'Tiramisù',             text: 'Minden reggel frissen.' },
    { id: 'g10', scene: 'kave',     cat: 'italok',   title: 'Eszpresszó',           text: 'A helyes lezárás.' },
    { id: 'g11', scene: 'szakacs',  cat: 'csapat',   title: 'Marco, a pizzaiolo',   text: 'Nápolyból, 2020 óta velünk.' },
    { id: 'g12', scene: 'futar',    cat: 'hely',     title: 'Kiszállítás',          text: '30 percen belül, melegen.' }
  ],
  galleryCats: [
    { id: 'all',    name: 'Minden' },
    { id: 'etelek', name: 'Ételek' },
    { id: 'konyha', name: 'A konyha' },
    { id: 'hely',   name: 'A hely' },
    { id: 'italok', name: 'Italok' },
    { id: 'csapat', name: 'A csapat' }
  ],

  /* --- Csapat ------------------------------------------------------------ */
  team: [
    { name: 'Marco Esposito', role: 'Pizzaiolo · társalapító',
      quote: 'A tészta nem siet. Én sem sietek.',
      bio: 'Nápolyban tanult, 14 évesen kezdte a Da Michele konyháján. 2020-ban költözött Budapestre.' },
    { name: 'Kovács Nóra', role: 'Társalapító · üzletvezető',
      quote: 'A vendég nem statisztika, hanem név.',
      bio: 'Vendéglátós család harmadik generációja. Ő tartja össze a csapatot és a foglalási naptárat.' },
    { name: 'Tóth Bence', role: 'Séf · tészták',
      quote: 'Tejszín a carbonarába? Nem ebben az étteremben.',
      bio: 'Bolognában töltött három évet. A ragu receptje tőle van, és nem adja ki senkinek.' },
    { name: 'Farkas Lili', role: 'Cukrász',
      quote: 'A tiramisù délután háromra elfogy. Ez nem az én hibám.',
      bio: 'Minden desszertet ő készít, minden reggel hatkor. A gelato ízeit hetente újratervezi.' }
  ],

  /* --- Idővonal ---------------------------------------------------------- */
  timeline: [
    { year: '2020', title: 'Kinyitottunk', text: 'Januárban, három héttel a lezárások előtt. Nem a legjobb időzítés — de kitartottunk.' },
    { year: '2021', title: 'Megérkezett a kemence', text: 'Nápolyból hozattuk, kézzel rakott samottból. Két hétig száradt, mielőtt először befűtöttük.' },
    { year: '2022', title: 'Első helyezés', text: 'Bekerültünk Budapest 10 legjobb pizzériája közé egy független szaklap listáján.' },
    { year: '2023', title: 'Terasz és kert', text: 'Megnyílt a 24 fős terasz saját bazsalikom- és paradicsomágyással.' },
    { year: '2024', title: 'Vegán vonal', text: 'Fél évig fejlesztettük a növényi mozzarellát. Ma a rendelések 18%-a vegán.' },
    { year: '2026', title: 'Ahol most tartunk', text: '1200+ értékelés, 4,9 átlag, és még mindig ugyanaz a tészta-recept.' }
  ],

  /* --- Vélemények -------------------------------------------------------- */
  reviews: [
    { name: 'Szabó Gergő', where: 'Google', stars: 5,
      text: 'Öt éve járok ide, és soha nem volt rossz élményem. A Diavola a városban a legjobb, pont annyira csípős, amennyire kell.' },
    { name: 'Anna K.', where: 'TripAdvisor', stars: 5,
      text: 'A bivalymozzarella tényleg más kategória. A személyzet elmagyarázta, honnan érkezik és mikor. Ez a törődés ritka.' },
    { name: 'Nagy Péter', where: 'Foglalás után', stars: 5,
      text: 'Gluténmentes tésztát kértünk, és nem éreztem rajta, hogy "kompromisszum". A gyerek külön tányért kapott, kérés nélkül.' },
    { name: 'Judit és Tamás', where: 'Google', stars: 5,
      text: 'Az évfordulónkra foglaltunk. Gyertya, kézzel írt üdvözlőlap az asztalon. Nem kértük — csak észrevették a megjegyzésünkből.' },
    { name: 'Márk', where: 'Instagram', stars: 4,
      text: 'Pénteken tele van, foglalás nélkül nehéz. De megéri várni. A Bianca Tartufo külön utazás.' }
  ],

  /* --- GYIK -------------------------------------------------------------- */
  faq: [
    { q: 'Kell asztalt foglalni?', a: 'Hétköznap délben általában nem, de csütörtök estétől vasárnapig erősen ajánlott. Online 30 másodperc, és azonnal visszaigazolunk.' },
    { q: 'Van gluténmentes tészta?', a: 'Igen, +690 Ft felárral, minden pizzához kérhető. Külön munkafelületen és külön lapáton készítjük, de a kemence közös — súlyos cöliákia esetén ezt érdemes tudni.' },
    { q: 'Vegán opciók?', a: 'A Marinara, a Panzanella és az Arrabbiata alapból vegán. A Verde Vegana növényi mozzarellával készül, és bármelyik pizzánk kérhető növényi sajttal.' },
    { q: 'Mennyi idő egy pizza?', a: 'A kemencében 90 másodperc. Az asztalig jellemzően 12–18 perc a rendeléstől. Csúcsidőben (péntek 19–21 óra) ez 25 percre nőhet.' },
    { q: 'Van házhozszállítás?', a: 'Igen, 5 km-es körzetben, saját futárral. 30 perc az átlag. 12 000 Ft felett ingyenes, alatta 890 Ft.' },
    { q: 'Kutyát vihetek?', a: 'A teraszra igen, örömmel — vizestál jár hozzá. A belső térben sajnos nem, kivéve segítő kutyát.' },
    { q: 'Rendezvényt tudtok tartani?', a: 'Igen. 20 fő fölött a teljes teraszt, 40 fő fölött a teljes éttermet bérelhetitek. Írj a foglalas@basilicobistro.hu címre.' },
    { q: 'Van gyerekmenü?', a: 'Külön menü nincs, de bármelyik pizzát kérheted 24 cm-es "bambino" méretben 2290 Ft-ért. Etetőszék és pelenkázó van.' }
  ],

  /* --- Asztalok (alaprajz) ------------------------------------------------ */
  tables: [
    { id: 1,  x: 90,  y: 108, r: 24, seats: 2, zone: 'Ablak' },
    { id: 2,  x: 176, y: 100, r: 24, seats: 2, zone: 'Ablak' },
    { id: 3,  x: 262, y: 108, r: 28, seats: 4, zone: 'Terem' },
    { id: 4,  x: 356, y: 100, r: 28, seats: 4, zone: 'Terem' },
    { id: 5,  x: 444, y: 112, r: 24, seats: 2, zone: 'Bárpult' },
    { id: 6,  x: 84,  y: 200, r: 28, seats: 4, zone: 'Terem' },
    { id: 7,  x: 180, y: 208, r: 32, seats: 6, zone: 'Nagyasztal' },
    { id: 8,  x: 286, y: 200, r: 28, seats: 4, zone: 'Terem' },
    { id: 9,  x: 378, y: 208, r: 24, seats: 2, zone: 'Csendes sarok' },
    { id: 10, x: 452, y: 196, r: 32, seats: 8, zone: 'Nagyasztal' }
  ],

  /* --- Foglalási idősávok ------------------------------------------------- */
  slots: ['11:30', '12:00', '12:30', '13:00', '13:30', '14:00',
          '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
          '20:00', '20:30', '21:00', '21:30'],

  occasions: ['Baráti vacsora', 'Randi', 'Születésnap', 'Évforduló', 'Céges', 'Családi ebéd', 'Egyéb'],

  /* --- Statisztikák (főoldal) --------------------------------------------- */
  stats: [
    { num: 6,     suffix: '',   label: 'Éve nyitva' },
    { num: 128,   suffix: 'K',  label: 'Kisütött pizza' },
    { num: 4.9,   suffix: '',   label: 'Google értékelés', dec: 1 },
    { num: 90,    suffix: ' mp',label: 'Sütési idő' }
  ],

  /* --- Futósáv szövegei ---------------------------------------------------- */
  ticker: ['Kőkemence', '48 órás tészta', 'Bivalymozzarella DOP', 'Napi friss tiramisù',
           'Kutyabarát terasz', 'Vegán opciók', 'Helyben sütött kovász', 'Nápolyi recept'],

  /* --- Kedvezmények / hírek ------------------------------------------------ */
  promos: [
    { icon: '🍕', title: 'Kedd = Margherita nap', text: 'Minden kedden a Margherita 2290 Ft, egész nap.' },
    { icon: '🍷', title: 'Aperitivo 17–19', text: 'Aperol Spritz + bruschetta 2990 Ft, hétköznap.' },
    { icon: '🎓', title: 'Diákkedvezmény', text: 'Érvényes diákigazolvánnyal 15% minden ételre, 15 óráig.' },
    { icon: '🚴', title: 'Ingyen szállítás', text: '12 000 Ft feletti rendelésnél, 5 km-en belül.' }
  ],

  /* --- Kezdeti foglalások (demó, hogy az admin ne legyen üres) -------------- */
  seedBookings: [
    { code: 'BB-4821', name: 'Horváth Réka',  phone: '+36 30 111 2233', people: 4, date: 0, time: '19:00', table: 3,  occasion: 'Születésnap', note: 'Tortát hozunk, kérünk gyertyát.', status: 'confirmed', created: '' },
    { code: 'BB-4822', name: 'Kiss Dániel',   phone: '+36 20 444 5566', people: 2, date: 0, time: '20:00', table: 1,  occasion: 'Randi', note: '', status: 'new', created: '' },
    { code: 'BB-4823', name: 'Varga család',  phone: '+36 70 777 8899', people: 6, date: 1, time: '13:00', table: 7,  occasion: 'Családi ebéd', note: 'Etetőszék kellene, 2 gyerek.', status: 'confirmed', created: '' },
    { code: 'BB-4824', name: 'Molnár Ádám',   phone: '+36 30 222 3344', people: 8, date: 2, time: '19:30', table: 10, occasion: 'Céges', note: 'Számlát kérünk cégre.', status: 'new', created: '' },
    { code: 'BB-4825', name: 'Balogh Eszter', phone: '+36 20 999 0011', people: 2, date: 3, time: '18:00', table: 9,  occasion: 'Évforduló', note: 'Gluténérzékeny vagyok.', status: 'confirmed', created: '' }
  ],

  /* --- Kezdeti üzenetek ----------------------------------------------------- */
  seedMessages: [
    { name: 'Szalai Márton', email: 'm.szalai@example.hu', subject: 'Céges rendezvény 35 főre',
      body: 'Sziasztok! Novemberre keresünk helyszínt egy 35 fős céges vacsorához. Van rá lehetőség, hogy kibéreljük a teljes éttermet? Milyen menüket tudtok ajánlani?', read: false, days: 0 },
    { name: 'Pintér Anna', email: 'anna.p@example.hu', subject: 'Elhagyott sál',
      body: 'Szombat este nálatok vacsoráztunk, és ott felejtettem egy bordó gyapjúsálat a 4-es asztalnál. Megvan esetleg?', read: false, days: 1 },
    { name: 'Deák Roland', email: 'deak.r@example.hu', subject: 'Gratuláció',
      body: 'Csak annyit szeretnék mondani, hogy a Bianca Tartufo életem legjobb pizzája volt. Köszönöm. Jövő héten újra jövünk.', read: true, days: 3 },
    { name: 'Tóth Krisztina', email: 'k.toth@example.hu', subject: 'Allergia kérdés',
      body: 'Diófélékre allergiás a párom. Melyik desszertek biztonságosak számára? A cannoliban van pisztácia, gondolom.', read: true, days: 4 }
  ],

  /* --- Admin belépés (demó) --------------------------------------------------
     ÉLES HASZNÁLATBAN cseréld le szerveroldali hitelesítésre!
     Ez itt csak bemutató célú, kliensoldali kapu.                              */
  admin: { user: 'admin', pass: 'basilico2026' }
};

window.DATA = DATA;
