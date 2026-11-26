// zh catalogue, namespace 'info'. Flat 'key': 'text' with {placeholders}; see docs/I18N.md.
export default {
  'info.recovery.title': '肌肉恢复',
  'info.recovery.p1': '这是估算，不是测量。区间先按经验值：高强度训练的肌群通常需要 48–72 h，小肌群更短，腿部更长。',
  'info.recovery.p2': '恢复中 = 区间之前 · 可能已就绪 = 区间之内 · 已恢复 = 超过区间。点按肌群提交反馈；约 {minPoints} 次反馈后，区间将改为你的个人区间。恢复速度只按比例调整经验值。',

  'info.recoveryMath.title': '组数如何影响恢复窗口',
  'info.recoveryMath.p1': '组数按每周组数的方式计算。区间以 {ref} 个高强度组为准：1 组 × {f1}，8 组 × {f8}，9 组及以上 × {fMax}。计入不足 {minDose} 组时不会重新计时。',
  'info.recoveryMath.p2': '在窗口内再次训练，剩余负荷会累加。经验值区间保持在 {capMin}–{capMax} h，个人区间在 {customMin}–{customMax} h。只计算最近 {days} 天。',

  'info.recoveryYours.title': '你的区间',
  'info.recoveryYours.p1': '“仍酸痛”表示恢复用时更长；“已恢复”表示更短。反馈按 {ref} 组换算，近期训练权重更高，同一次训练中相互矛盾的反馈会被排除。',
  'info.recoveryYours.p2': '在 {minBouts} 次训练中有 {minPoints} 次有效反馈、且两种回答都有后，区间将改为你的个人区间：取你回答的中间值，回答少时区间更宽。手动设置的区间仍然优先。',

  'info.sets.title': '每周组数',
  'info.sets.p1': '每个肌群周一至周日已完成的普通组。直接（该肌群为主要发力肌）计 × {primary}；间接（辅助发力）× {secondary}；递减组 × {dropset}。',
  'info.sets.p2': '可在“设置 › 组数权重”中修改系数。设有目标时，每行显示“已完成 / 目标”，达到 100 % 时进度条填满。',

  'info.setsWorkout.title': '各肌群组数',
  'info.setsWorkout.p1': '本次训练每个肌群已完成的普通组。直接（该肌群为主要发力肌）计 × {primary}；间接（辅助发力）× {secondary}；递减组 × {dropset}。',
  'info.setsWorkout.p2': '它们计入当周的每周组数。',

  'info.tonnage.title': '总重量',
  'info.tonnage.p1': '已完成普通组的重量 × 次数，单位 kg；从 {tFrom} kg 起以 t 显示（1 t = {tKg} kg）。单组和单个动作始终以 kg 显示。递减组单独显示；自重组计 0 kg。',
  'info.tonnage.p2': '按肌群：每个动作的总重量平均分给其直接肌群。训练计划图表显示最近 8 次训练；% = 与上一次相比的变化。',

  'info.records.title': '纪录',
  'info.records.p1': '纪录指超过该动作以往每次训练的成绩：最重组、单组总重量、估算 1RM、单次训练总重量，或自重动作的次数。只计已完成的普通组。第一次训练确立基准。',
  'info.records.p2': '本月与上月同期相比；起点和未完成的训练不计入。',

  'info.metrics.title': '进步指标',
  'info.metrics.p1': '最重组：已完成的最重一组；重量相同时次数多者优先。估算 1RM（Epley）：重量 × (1 + 次数 / 30)。总重量：已完成组的重量 × 次数。',
  'info.metrics.p2': '最多次数：单组最多次数。总次数：所有已完成组。递减组从不计入。自重动作按次数进步。高亮的点为纪录。',

  'info.topExercises.title': '常练动作',
  'info.topExercises.p1': '最近 8 周训练次数最多的动作。数值 = 最近一次训练的最佳估算 1RM，自重动作则为单组最多次数。% = 与这 8 周内第一次训练相比的变化。',

  'info.progression.title': '加重建议',
  'info.progression.p1': '你最大重量下的所有目标组都须达到目标次数（如 3 × 6–8 范围的上限）；之后会出现建议标签：该重量 + 加重幅度。较轻的热身组和降重组会被忽略，递减组从不计入，起点也从不触发建议。',
  'info.progression.p2': '点按建议标签前不会有任何改变。加重幅度为 0 = 不提供建议。',

  'info.starting.title': '起点',
  'info.starting.p1': '每个动作当前的训练重量 × 次数 × 组数，若最佳组不同，再加上最佳组。用于预填训练，并计入纪录。',
  'info.starting.p2': '它从不算作一次训练，也不会触发加重建议；那需要一次真正的训练。',

  'info.photo.title': '餐食照片估算',
  'info.photo.p1': 'AI 模型根据照片估算食物、克数、热量和宏量营养素。这些只是估算：添加前请检查。',
  'info.photo.p2': '每次分析都由你自己的服务商账户计费；已取消的请求也可能被计费。只会发送照片（最大 {px} px）和你的提示。',
  'info.photo.p3': '部分服务商会阻止浏览器调用；启用零数据保留的组织无法从浏览器调用 Anthropic。',

  'info.camera.title': '允许使用相机',
  'info.camera.p1': 'iPhone：设置 › Safari 浏览器 › 相机，或地址栏中的 aA 菜单。Android：地址栏中的锁形图标 › 权限。然后再次点按“扫描”。',

  'info.expenditure.title': '每日消耗',
  'info.expenditure.p1': '你每天平均消耗的 kcal，包括训练。来自你的数据：根据记录的食物和体重趋势估算。',
  'info.expenditure.p2': '需要最近 {windowDays} 天内有 {minWeighIns} 次称重和 {minLoggedDays} 个完整日，另有 {minSpanDays} 天的历史，且最近 {maxStaleDays} 天内有一次称重。在此之前：根据你的资料用公式（Mifflin-St Jeor × 活动水平）计算。漏记的天会使结果偏低。',

  'info.checkin.title': '每周复盘',
  'info.checkin.p1': '每周一，“趋势”会根据你的消耗和目标提出本周的热量目标。“接受”即应用；“保留当前”不做任何更改。',
  'info.checkin.p2': '每周变化最多 {maxChange} kcal，且绝不低于热量下限。',

  'info.complete.title': '完整记录日',
  'info.complete.p1': '今天从不计入。某个记录日若低于你平时摄入量的一半（前后 {weeks} 周内记录日的中位数），即为不完整日，可能没有记全。',
  'info.complete.p2': '不完整日不计入平均值、达标天数、最高和最低日、总计以及消耗估算。达标 = 完整日的热量在目标 ± 10 % 以内。',

  'info.trend.title': '体重趋势',
  'info.trend.p1': '移动平均值，可平滑每天的水分波动。关注趋势，而不是单日数值。每天早上如厕后、进食前称重。',
  'info.trend.p2': '趋势从第二次称重开始。每周变化与上周日结束时的趋势相比。',

  'info.report.title': '周报',
  'info.report.p1': '每周从周一到周日；只列出有记录的周。变化 = (本周 − 上周) / 上周；上周无数值时显示 –。',
  'info.report.p2': '目标来自当周的复盘。手动修改的目标不会被记录，因此过去几周显示的目标可能与你实际使用的不同。',

  'info.macros.title': '宏量营养素占比',
  'info.macros.p1': '蛋白质和碳水 4 kcal / g，脂肪 9 kcal / g。克数四舍五入为整数。',
  'info.macros.p2': '周报中的占比只使用完整日。',

  'info.adaptiveMacros.title': '自适应宏量营养素',
  'info.adaptiveMacros.p1': '蛋白质和脂肪按趋势体重以 g / kg 设定；碳水补足其余部分。',
  'info.adaptiveMacros.p2': '热量下限：建议目标的最低值。留空 = 女性 {female} kcal，男性 {male}，其他 {unknown}。',
  'info.adaptiveMacros.p3': '使用百分比分配时，复盘只更改热量，这些数值不会被使用。',

  'info.goal.title': '体重目标',
  'info.goal.p1': '每周最多减重 {lose} kg 或增重 {gain} kg。kcal 数值是达到该速度每天所需的热量缺口（或盈余），即与每日消耗的差值，按 {kcalPerKg} kcal / kg 计算。',
  'info.goal.p2': '每周复盘用它来建议目标。',

  'info.backup.title': '备份',
  'info.backup.p1': '所有数据只保存在此设备的这个浏览器中：没有账户，没有云端，没有同步。请定期导出备份，并把文件存到别处，例如云盘或发邮件给自己。',
  'info.backup.p2': '换新手机：在这里“导出备份”，再到新手机上“导入备份”；这会替换所有数据。API 密钥不在备份中。{days} 天后应用会提醒你。',

  'info.storage.title': '存储保护',
  'info.storage.p1': '已保护：浏览器不会自行删除数据；但清除网站数据或移除应用仍会删除。',
  'info.storage.p2': '未保护：存储空间不足时，浏览器可能会删除数据。安装应用并保留备份会有帮助。',

  'info.importWeights.title': '体重文件格式',
  'info.importWeights.p1': '日期如 12.11.2026、2026-11-12、12/11/26 或 Mon 12 Nov。体重如 82,5 或 82.5，单位 kg；不支持磅。',
  'info.importWeights.p2': '列之间用制表符、分号、逗号或空格分隔，顺序不限。可以有标题行。',

  'info.importWorkouts.title': '训练粘贴格式',
  'info.importWorkouts.p1': '动作名称单独一行，然后是 3 × 6（组数 × 次数）。之后每组一行：kg 和次数，用空格分隔，不要用逗号（80 6）。递减组 5x 80 = 80 kg 做 5 次。只有一个数字 = 自重次数。',
  'info.importWorkouts.p2': '日期行开始一次新训练；像 Push 这样的行为其命名。并排的表格：每次复制一组列。',

  'info.splitChoose.title': '选择分化',
  'info.splitChoose.p1': '选择你能坚持数月的训练天数。在每周组数相同的情况下，研究发现全身、上下肢和其他分化效果相近。',
  'info.splitChoose.p2': '天数较少：全身。四天：上下肢。五或六天：混合或推 / 拉 / 腿。每个肌群每周练约两次是简单的默认选择。',

  'info.splitRun.title': '执行分化',
  'info.splitRun.p1': '按顺序完成各训练日；“下一次”显示该做的那一个。同一肌群再次训练前休息一天。',
  'info.splitRun.p2': '所有组都达到次数范围上限？下次加重；否则多做一次。可把动作换成主要肌群相同的动作。停滞了？安排一周轻松训练，组数减半。',

  'info.splitSets.title': '每周组数',
  'info.splitSets.p1': '每个肌群一周的计划组数。直接（主要发力）计 × {primary}，间接（辅助）× {secondary}，与你的记录一致。',
  'info.splitSets.p2': '每周组数最重要；更多通常会多带来一点效果，但收益递减。范围只是一般参考，不是硬性规定。只有在能恢复并持续进步时才增加组数。',
};
