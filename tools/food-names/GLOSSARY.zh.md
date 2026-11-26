# Chinese (Simplified, zh) food names: glossary of recurring decisions

Segments of USDA names are translated once (`zh.json`) and composed in the original order, joined by "，"
(no capitalisation). Mechanics are the same as for German (see `GLOSSARY.de.md`, `tools/build-food-names.mjs`):
`"<first segment>|<segment>"` group keys, `"-"` drops a redundant segment, `overrides.zh.json` holds full names
by fdcId.

## Principles

- Mainland vocabulary as in the China Food Composition Tables and everyday supermarket/app language.
- Translate, do not explain: no information added or dropped. Keep the USDA segment order.
- Search is substring-based on the Chinese name (query runs must occur contiguously). Therefore:
  - Food-group heads use the word people type: 牛肉, 猪肉, 鸡肉, 羔羊肉 (contains 羊肉), 牛奶, 鸡蛋, 米, 土豆（马铃薯）.
  - Where the everyday word is a compound of group + part, a group key writes it out in full:
    `Chicken|breast` → 鸡胸肉, `Chicken|wing` → 鸡翅, `Chicken|drumstick` → 鸡腿（琵琶腿）, `Chicken|thigh` → 鸡大腿,
    `Beef|ground` → 牛肉馅（绞肉）, `Potatoes|mashed` → 土豆泥, `Rice|cooked` → 熟（米饭）, `Corn|sweet` → 甜玉米,
    `Peppers|sweet` → 甜椒, `Oil|olive` → 橄榄油 …
  - Synonyms in full-width parentheses where both are common: 西兰花（西蓝花）, 番茄（西红柿）, 三文鱼（鲑鱼）,
    大豆（黄豆）, 卷心菜（包菜）.
- Full-width punctuation inside names: （）、/ ； ASCII digits, `%`, `–` for ranges.
- Metric only: inch fat trim → 毫米, ounces → 克 / 毫升, US proof → % vol (proof ÷ 2), °F → °C, inches → 厘米.
- Brand and product names stay in Latin script (`Archway Home Style Cookies`, `Denver Cut`, `America's Beef Roast`)
  unless an official, widely used Chinese brand name exists (卡夫 Kraft, 家乐氏 Kellogg's, 雀巢 Nestlé, 麦当劳,
  肯德基, 汉堡王, 必胜客, 赛百味, 好时 Hershey's, 玛氏 Mars, 士力架 Snickers, M&M's kept). When unsure: Latin.
- USDA grades: `choice` → USDA Choice级, `select` → USDA Select级, `prime` → USDA Prime级, `all grades` → 所有等级.

## Cooking and processing

| English | Chinese | Note |
|---|---|---|
| raw / cooked / uncooked | 生 / 熟 / 未烹煮 | |
| boiled / simmered | 煮 / 小火煮 | |
| braised / stewed | 炖 / 炖煮 | |
| roasted | 烤 | nuts, seeds, coffee, grains: 烘烤 / 焙炒 via group key |
| dry roasted / oil roasted | 干烤 / 油焙 | |
| baked / toasted | 烘烤 / 烤制 | |
| broiled / grilled | 炙烤 / 烧烤 | US broiling = top heat; kept distinct |
| pan-fried / pan-broiled / pan-broil / pan-browned | 煎 / 干煎 / 干煎 / 煎至焦黄 | |
| fried | 油炸 | egg: 煎 (`Egg\|fried`) |
| fast fried / fast roasted | 快煎 / 快速烤 | NZ cuts |
| steamed / microwaved | 蒸 / 微波加热 | |
| rotisserie | 旋转烤制 | |
| dry heat / moist heat | 干热烹调 / 湿热烹调 | |
| heated / unheated | 加热 / 未加热 | |
| smoked / cured | 烟熏 / 腌制 | |
| dried / dry | 干制 / 干 | |
| canned / bottled / canned or bottled | 罐装 / 瓶装 / 罐装或瓶装 | |
| drained / drained solids / solids and liquids | 沥干 / 沥干（固形物） / 含汤汁 | |
| frozen / fresh | 冷冻 / 鲜 | |
| unprepared / prepared | 未调制 / 已调制 | |
| prepared from recipe | 按食谱自制 | |
| commercially prepared / commercial | 市售成品 / 市售 | |
| home-prepared | 家庭自制 | |
| ready-to-serve / ready-to-eat / ready-to-drink | 即食 / 即食 / 即饮 | |
| dry mix | 干粉预拌料 | |
| prepared with water / whole milk / 2% milk | 加水调制 / 用全脂牛奶调制 / 用2%脂肪牛奶调制 | |
| condensed | 浓缩 | milk: 炼乳 (`Milk\|condensed`) |
| instant | 速溶 | cereals: 即食 |
| with salt / without salt | 加盐 / 不加盐 | |
| with salt added / no salt added / without salt added | 添加盐 / 无添加盐 / 未添加盐 | kept distinct to avoid collisions |
| salted / unsalted | 咸 / 无盐 | |
| enriched / unenriched | 营养强化 / 未强化 | |
| low sodium / reduced sodium | 低钠 / 减钠 | |
| reduced fat / low fat, lowfat / nonfat / fat free, fat-free | 减脂 / 低脂 / 脱脂 / 无脂肪, 无脂 | |
| low calorie / reduced calorie | 低热量 / 减热量 | |
| sweetened / unsweetened | 加糖 / 不加糖 | |
| imported | 进口 | |
| plain / regular | 原味 / 普通 | |
| light | 淡味 | beer, ice cream: 清爽型 / 轻 via group key where needed |
| whole | 整 | egg 全蛋, milk 全脂 via group keys |

## Meat

| English | Chinese |
|---|---|
| Beef / Pork / Lamb / Veal / Chicken / Turkey | 牛肉 / 猪肉 / 羔羊肉 / 小牛肉 / 鸡肉 / 火鸡 |
| separable lean and fat / separable lean only / separable fat | 瘦肉和脂肪 / 仅瘦肉 / 仅脂肪 |
| trimmed to 0" / 1/8" / 1/4" fat | 修脂至0毫米 / 修脂至3毫米 / 修脂至6毫米 |
| boneless / bone-in | 去骨 / 带骨 |
| meat only / meat and skin | 仅肉 / 带皮肉 |
| light meat / dark meat | 浅色肉 / 深色肉 |
| variety meats and by-products | 内脏及副产品 |
| broilers or fryers | 肉鸡 |
| composite of trimmed retail cuts | 修整零售分割肉综合 |
| ground | 绞碎; meat groups: 牛肉馅（绞肉） etc.; spices: 粉 |
| steak | 排; beef 牛排, pork 猪排 |
| roast (cut) | 烤肉块 |
| chuck / blade / shoulder clod / top blade | 肩胛（Chuck） / 板腱（Blade）, pork 梅花肉（Blade） / 肩肉（Shoulder Clod） / 板腱（Top Blade） |
| rib / rib eye | 肋脊（Rib） / 肉眼（Rib Eye） |
| loin / short loin / top loin | 腰脊（Loin）, pork 大排（Loin） / 前腰脊（Short Loin） / 西冷（Top Loin）, pork 通脊 |
| tenderloin | 里脊（菲力）; pork 里脊（小里脊，Tenderloin） |
| sirloin / top sirloin / tri-tip | 臀腰肉（Sirloin） / 上臀腰（Top Sirloin） / 三角尖（Tri-Tip） |
| round / top round / bottom round / eye of round / tip round, knuckle | 后腿（Round） / 针扒（Top Round） / 米龙（Bottom Round） / 小黄瓜条（Eye of Round） / 牛霖 |
| brisket / flank / plate / skirt | 牛胸肉（Brisket） / 腹肉（Flank） / 胸腹（Plate） / 裙肉（Skirt） |
| shank | 腱子（Shank）; pork 肘子, lamb 羊腱 |
| breast / wing / drumstick / thigh / leg / back | 胸肉 / 翅 / 小腿 / 大腿 / 腿 / 背; chicken: 鸡胸肉 / 鸡翅 / 鸡腿（琵琶腿） / 鸡大腿 / 鸡腿（全腿） |
| US steak names without Chinese equivalent | Chinese descriptive + English in parentheses or kept: T骨牛排, 红屋牛排（Porterhouse）, Denver Cut, Mock Tender牛排 |
| lip-on / lip off | 带脂盖（Lip-on） / 去脂盖（Lip-off） |

## Other recurring decisions

| English | Chinese |
|---|---|
| Beverages / Alcoholic beverage | 饮料 / 酒精饮料 |
| wine, table | 葡萄酒，佐餐 |
| 80 proof | 40% vol |
| (Includes foods for USDA's Food Distribution Program) | （含USDA食品分发计划食品） |
| NFS (not further specified) | 未细分 |
| heavy / light syrup pack, juice pack, water pack | 浓糖浆装 / 淡糖浆装, 果汁浸装, 水浸装 |
| mature seeds / immature seeds | 成熟种子 / 未成熟种子 |
| Egg | 鸡蛋 (chicken egg); duck/goose/quail/turkey eggs via overrides (鸭蛋 …) |
| Milk | 牛奶; goat/sheep/buffalo/human milk via overrides (山羊奶 …) |
| Squash, summer / winter | 南瓜类，夏南瓜 / 冬南瓜 |
| Cookies / Crackers | 曲奇饼干 / 咸饼干 |
| light | 轻（Light）; tuna 浅色肉, rye flour / corn syrup 浅色, beer 淡啤（Light） |
| wine dry / sweet | 干型 / 甜型 (`Alcoholic beverage\|dry`, `…\|sweet`) |
| tea black / green | 红茶 / 绿茶 (`Beverages\|black`, `Beverages\|green`) |
| oyster | 牡蛎（生蚝）; mushroom 平菇, sauce 蚝油, ostrich/emu cut Oyster部位 |
| brisket / beef shank / beef tenderloin / spareribs | 牛腩（Brisket） / 牛腱（Shank） / 牛里脊（菲力） / 排骨（肋排，Spareribs） |
| offal | 牛肝, 牛心, 牛舌, 牛腰（肾）, 猪肝, 猪心, 猪舌, 猪腰（肾）, 鸡肝, 鸡心 … via group keys; generic 肝 / 心 / 舌 / 肾 |
| Oil, \<plant\> | 橄榄油, 玉米油, 花生油, 大豆油, 葵花籽油, 椰子油 … via `Oil\|…`; `Oil\|vegetable` 植物油 |
| sugar granulated / powdered, maple syrup | 白砂糖 / 糖粉, 枫糖浆 |
| Beans black / pink / white, adzuki | 黑豆 / 粉红豆 / 白豆, 红豆（红小豆） |
| sprouted mung beans / soybeans | 发芽（豆芽） / 发芽（黄豆芽） |
| Cereals, oats | 燕麦片 |
| Greek yogurt, whole-wheat bread, whole-grain wheat flour | 希腊酸奶, 全麦面包, 全麦粉（全谷物） |
| sweet cherries | 甜樱桃（车厘子） |

## Overrides (`overrides.zh.json`)

Full names by fdcId where segment composition reads wrong:
- Lists USDA spreads over several segments ("…, calcium, and potassium") are joined with 、 and 和.
- Eggs of other birds (鸭蛋, 鹅蛋, 鹌鹑蛋, 火鸡蛋) and milk of other animals (山羊奶, 绵羊奶, 水牛奶, 母乳), so that
  they do not start with 鸡蛋 / 牛奶.
- Chinese cabbages (小白菜, 大白菜, 芥菜, 韩式泡菜) and Chinese broccoli (芥蓝), which USDA files under Cabbage / Broccoli.
- Rainbow smelt (虹胡瓜鱼), since `Fish|rainbow` is 虹鳟 for trout.

## Kept in Latin script

Brand, product and flavour names of branded items (Archway, Pepperidge Farm Goldfish flavours, Pillsbury, Martha White,
Mission, Nabisco, Glutino, Udi's, …), vitamin letters, and a few rare plants without an established Chinese name
(Abiyuch, Eppaw, Rowal). Same choice as the German list.

## Review fixes (2026-11-26)

- Segments written for one food group must not leak into another (checked by listing, per segment, the first
  segments it occurs with): `Noodles|flat` 扁平 (not the beef cut 扁平部), `Squash|scallop` 飞碟瓜 (not 扇贝),
  `Potatoes|steak cut` 粗条切, `Potatoes|…flakes…` 土豆雪花片 (薯片 = crisps), `Cheese|dry white` 干质白奶酪
  (干白 = dry white wine).
- 菲力 means tenderloin only. US "filet" cuts of other muscles: 肉眼小排（Ribeye Filet）, 西冷厚切（Top Loin Filet）,
  上臀腰嫩块（Top Sirloin Filet）; "petite roast/filet" → 小肉块.
- Pork: Loin 大排（Loin） (里脊 is the tenderloin to mainland users), Tenderloin 里脊（小里脊，Tenderloin）.
- `Chicken|roasting` 烤制用鸡（大龄肉鸡） (a bird type, not a cooking state); chicken parts as people type them:
  鸡爪, 鸡胗, 鸡皮. Fried egg 煎蛋, poached egg 水波蛋.
- Two-part names read the Chinese way where a group key can do it: 白面包, 黑麦面包, 面包棒, 鸡蛋面, 巧克力牛奶,
  油豆腐（炸豆腐）, 米糠油, 毛豆（青大豆）, 番茄膏 / 番茄泥 / 番茄酱汁, 中式 (not 中国). Pita and gluten-free white
  bread via overrides. Rice flour 大米粉 (米粉 = rice noodles).
- Mollusks 软体动物 (octopus and squid are not 贝类).
- Characters outside GB2312: replaced where a common mainland name exists (安康鱼, 长鳕, 大眼梭鲈, 油甘鱼, 腌猪肘,
  伍斯特酱（辣酱油）); kept where they are the usual mainland form: 焗 (焗烤 on mainland menus), 鮰 (斑点叉尾鮰), 榅桲,
  and the GB18030 fish names 鲹 / 鳀 / 鳚 / 鲉 / 鲯.
- Everyday search words that the USDA order cannot produce are aliases in `src/data/generic-foods-common.json`
  (芝士, 吐司, 意面, 糙米饭, 猪里脊, 煎鸡蛋), checked by `tests/food-search-common.test.js`.
