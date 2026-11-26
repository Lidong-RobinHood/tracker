# German food names: glossary of recurring decisions

Segments of USDA names are translated once (`de.json`) and composed in the original order, joined by ", ".
The first letter of the composed name is capitalised. Mechanics (see `tools/build-food-names.mjs`):

- `"<first segment>|<segment>"` overrides a segment for one food group (`"Nuts|roasted": "geröstet"`,
  `"Egg|fried": "gebraten"`, `"Spices|ground": "gemahlen"`, `"Milk|whole": "Vollmilch"`). 100 such keys in de.json.
- A translation of `"-"` drops the segment when its meaning is already in another one
  (`"roughy": "Granatbarsch (Orange Roughy)"` + `"Fish|orange": "-"`; `"Peppers|sweet": "-"` → "Paprika, rot, roh").
- German only: a segment starting with "und"/"oder" is joined without a comma ("Calcium und Kalium").
- Full-name fixes go to `overrides.de.json` (by fdcId), used for 41 names: hot peppers ("Chili, …" instead of
  "Paprika, …") and lists that USDA spreads over several segments ("zubereitet mit Milch, Margarine und Eiern"), snap beans and buttermilk from whole milk.

Chinese (`zh.json`) should mirror the same structure and decisions; group keys and "-" work for any language
(Chinese names are joined with "，", no capitalisation).

## Principles

- Translate, do not explain: no information added or dropped. Keep the USDA segment order.
- Nouns capitalised; adjectives/participles lower case (`roh`, `gegart`, `ohne Knochen`).
- Metric only: inch fat trim → mm, ounces → g or ml, US proof → % vol (proof ÷ 2), °F → °C.
- Decimal comma and a space before % (`3,25 %`, `70 % mageres Fleisch`).
- Brand and product names unchanged (`Archway Home Style Cookies`, `Denver Cut`, `America's Beef Roast`).
- US beef cuts: the closest German cut if a real one exists, followed by the US name in parentheses where
  the German term is broader or ambiguous (`Keule (Round)`). No real equivalent → keep the English term.
- USDA grades: `choice` → `USDA Choice`, `select` → `USDA Select`, `prime` → `USDA Prime`,
  `all grades` → `alle Qualitätsstufen`.

## Cooking and processing

| English | German | Note |
|---|---|---|
| raw | roh | |
| cooked | gegart | generic "cooked" |
| boiled | gekocht | |
| simmered | geköchelt | kept distinct from boiled |
| braised | geschmort | |
| stewed | gedünstet | fruit; meat/poultry: geschmort via group key |
| roasted | gebraten | meat/poultry (oven); nuts, seeds, coffee, grains: geröstet via group key |
| dry roasted / oil roasted | ohne Öl geröstet / in Öl geröstet | nuts, seeds |
| broiled | gegrillt (Ofengrill) | US broiling = top heat; kept distinct from grilled |
| grilled | gegrillt | |
| pan-fried / pan-broiled / pan-browned | in der Pfanne gebraten / in der Pfanne ohne Fett gebraten / in der Pfanne angebraten | |
| fried | frittiert | batter/flour coated poultry, fish; eggs and others "gebraten" via group key |
| fast fried / fast roasted | kurzgebraten / kurz gebraten im Ofen | New Zealand cuts |
| steamed / microwaved / baked | gedämpft / in der Mikrowelle gegart / gebacken | |
| dry heat / moist heat | mit trockener Hitze / mit feuchter Hitze | fish, shellfish |
| heated / unheated | erhitzt / nicht erhitzt | |
| smoked / cured | geräuchert / gepökelt | |
| dried / dry | getrocknet / trocken | |
| canned | Konserve | |
| drained | abgetropft | |
| drained solids | abgetropft (feste Bestandteile) | |
| solids and liquids | mit Flüssigkeit | |
| frozen / fresh | tiefgekühlt / frisch | |
| unprepared / prepared | unzubereitet / zubereitet | |
| prepared from recipe | nach Rezept zubereitet | |
| commercially prepared | Fertigprodukt | |
| home-prepared | selbst zubereitet | |
| ready-to-serve / ready-to-eat / ready-to-drink | verzehrfertig / verzehrfertig / trinkfertig | |
| dry mix | Trockenmischung | |
| prepared with water / whole milk / 2% milk | mit Wasser zubereitet / mit Vollmilch zubereitet / mit Milch 2 % Fett zubereitet | |
| with salt / without salt | mit Salz / ohne Salz | |
| with salt added / no salt added | mit Salzzusatz / ohne Salzzusatz | |
| enriched / unenriched | angereichert / nicht angereichert | |
| low sodium / reduced sodium | natriumarm / natriumreduziert | |
| reduced fat / low fat / lowfat / nonfat / fat free | fettreduziert / fettarm / fettarm / entrahmt (dairy) or fettfrei / fettfrei | |
| imported | importiert | |

## Meat

| English | German |
|---|---|
| Beef / Pork / Lamb / Veal / Chicken / Turkey | Rind / Schwein / Lamm / Kalb / Hähnchen / Pute |
| separable lean and fat | Fleisch mit Fett |
| separable lean only | nur mageres Fleisch |
| separable fat | nur Fett |
| trimmed to 0" / 1/8" / 1/4" fat | Fettrand 0 mm / Fettrand 3 mm / Fettrand 6 mm |
| boneless / bone-in | ohne Knochen / mit Knochen |
| meat only / meat and skin | nur Fleisch / Fleisch mit Haut |
| light meat / dark meat | helles Fleisch / dunkles Fleisch |
| variety meats and by-products | Innereien und Nebenprodukte |
| broilers or fryers | Brathähnchen |
| composite of trimmed retail cuts | Mischung zugeschnittener Teilstücke |
| ground | Hackfleisch (meat) / gemahlen (spices, seeds) |
| chuck | Schulter (Chuck) |
| round / bottom round / top round / eye of round | Keule (Round) / Unterschale (Bottom Round) / Oberschale (Top Round) / Schwanzstück (Eye of Round) |
| loin (beef) / short loin / top loin | Rücken (Loin) / Roastbeef (Short Loin) / Roastbeef (Top Loin) |
| loin (pork) | Kotelettstrang (Loin) |
| tenderloin | Filet |
| rib / rib eye | Hochrippe (Rib) / Rib-Eye |
| brisket / flank / plate | Brust / Dünnung (Flank) / Spannrippe (Plate) |
| shank | Hesse (beef) / Haxe (pork, lamb) |
| sirloin / top sirloin / tri-tip | Hüfte (Sirloin) / Hüfte (Top Sirloin) / Bürgermeisterstück (Tri-Tip) |
| shoulder / leg / breast / thigh / drumstick / wing / back | Schulter / Keule / Brust / Oberschenkel / Unterschenkel / Flügel / Rücken |
| steak / roast | Steak / Braten |
| Steaks with US names (porterhouse, t-bone, flat iron, Denver Cut, ...) | kept (Porterhouse-Steak, T-Bone-Steak) |
| lip-on / lip off | mit Fettdeckel (Lip-on) / ohne Fettdeckel (Lip-off) |

## Other recurring decisions

| English | German |
|---|---|
| Beverages / Alcoholic beverage | Getränke / Alkoholisches Getränk |
| wine, table | Wein, Tafelwein (`Alcoholic beverage\|table`) |
| 80 proof | 40 % vol |
| 8 fl oz / 1/2 cup / 1.5 ounce / 8 inch / 1" steak | 237 ml / 120 ml / 43 g / 20 cm / 2,5 cm dickes Steak |
| (Includes foods for USDA's Food Distribution Program) | (inkl. Lebensmittel des USDA Food Distribution Program) |
| NFS (not further specified) | o. n. A. |
| canned, heavy / light syrup pack, juice pack, water pack | Konserve, in schwerem / leichtem Sirup, in Saft, in Wasser |
| Peppers, sweet / hot chili | Paprika / Chili, scharf (overrides) |
| Squash, summer / winter | Kürbis, Sommer / Winter |
| Cereals / Cereals ready-to-eat | Getreideprodukte / Frühstückscerealien, verzehrfertig |
| Candies / Snacks / Frozen novelties | Süßwaren / Snacks / Eisspezialitäten |
| Biscuits (US quick bread) | Biscuits (US-Brötchen) |
| US/NZ/Australian cuts without German equivalent | kept in English (Denver Cut, Short Ribs, Back Ribs, Mock Tender Steak, bolar blade, cube roll) |
| American fish species | German name if one exists, else German family name + English in parentheses ("Umberfisch (Croaker)") |
| Brand / product names (also mixed-case ones the brand filter misses) | unchanged; "Schar" → "Schär" (actual brand spelling) |
| Wheat, hard red spring / soft white | Weizen, harter Rotweizen, Sommerweizen / weicher Weißweizen; durum → Hartweizen |

## Segments shared by unrelated groups (group keys, checked by a sweep of every segment per first segment)

| English | German | Note |
|---|---|---|
| kidney (Beef, Lamb organ) | Niere | `Beans\|kidney` stays „Kidney“ (Kidneybohnen) |
| vegetable (Oil, Shortening) | pflanzlich | not „Gemüse“ |
| oyster | Auster (Mollusks, Sauce), Austernpilze (Mushrooms) | Emu/Ostrich cut stays „Oyster“ |
| snap beans | grüne Bohnen / Wachsbohnen (gelb) | full names in overrides.de.json (the colour segment would double) |
| flat (Noodles) / scallop (Squash) / summer (Sausage) / dark (Syrups) | flach / Patisson / Summer Sausage (Dauerwurst) / dunkel | |
| cake (Wheat flour) / creamed (Nuts) / mustard (Cabbage) / duck (Sauce) | Kuchenmehl / als Kokosmus / Senfkohl / Duck Sauce (süßsauer, ohne Ente) | |
| enhanced (Pork) | mit Lake behandelt (Enhanced) | „angereichert“ is reserved for enriched/fortified |
| oats (Cereals); regular and quick | Haferflocken; kernig und zart | plain oats show „Haferflocken“ |
| powdered / maple (Sugars) | Puderzucker / Ahornzucker | |
| stir-fried / thick | im Wok gebraten / dickflüssig | no calques |
| Liver cheese / malt beer | Leberpastete (Liver Cheese) / Malzgetränk | false friends: Leberkäse has no liver, Malzbier is non-alcoholic |
