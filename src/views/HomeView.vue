<script setup lang="ts">
import AppLayout from '../components/AppLayout.vue'
import StatCard from '../components/StatCard.vue'
import QwenBalanceCard from '../components/QwenBalanceCard.vue'

const stats = [
  {
    label: '总营收',
    value: '¥2,847,392',
    delta: '12.4%',
    trend: 'up' as const,
    spark: [30, 38, 34, 46, 52, 60, 58, 70, 66, 78],
  },
  {
    label: '活跃用户',
    value: '48,291',
    delta: '8.7%',
    trend: 'up' as const,
    spark: [40, 42, 39, 48, 52, 50, 58, 62, 60, 68],
  },
  {
    label: '转化率',
    value: '3.84%',
    delta: '1.2%',
    trend: 'down' as const,
    spark: [60, 58, 62, 55, 57, 52, 54, 50, 48, 46],
  },
  {
    label: '平均会话时长',
    value: '4分 32秒',
    delta: '2.1%',
    trend: 'up' as const,
    spark: [44, 46, 45, 50, 48, 53, 55, 54, 58, 60],
  },
]

const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

const revenue = [38, 45, 42, 58, 63, 75, 70, 88, 95, 90, 98, 112]
const sessions = [30, 36, 34, 44, 48, 56, 52, 64, 70, 66, 72, 82]
const CW = 640
const CH = 240
const PAD = 10
const lineMax = Math.max(...revenue, ...sessions)
const lineX = (i: number) => PAD + (i * (CW - PAD * 2)) / (revenue.length - 1)
const lineY = (v: number) => CH - PAD - (v / lineMax) * (CH - PAD * 2)
const revenueLine = revenue.map((v, i) => `${lineX(i)},${lineY(v)}`).join(' ')
const sessionsLine = sessions.map((v, i) => `${lineX(i)},${lineY(v)}`).join(' ')
const revenueArea = `${PAD},${CH - PAD} ${revenueLine} ${CW - PAD},${CH - PAD}`

const signups = [380, 420, 300, 520, 610, 430, 560, 680, 720, 540, 700, 650]
const renewals = [220, 260, 180, 320, 380, 300, 420, 470, 500, 380, 520, 480]
const BW = 640
const BH = 240
const BPAD = 10
const barMax = Math.max(...signups, ...renewals)
const groupW = (BW - BPAD * 2) / signups.length
const barW = groupW * 0.3
const barH = (v: number) => (v / barMax) * (BH - BPAD * 2)
const barY = (v: number) => BH - BPAD - barH(v)
</script>

<template>
  <AppLayout>
    <div class="balance-row">
      <QwenBalanceCard />
    </div>

    <div class="stats">
      <StatCard v-for="s in stats" :key="s.label" v-bind="s" />
    </div>

    <div class="charts">
      <section class="card chart">
        <div class="chart-head">
          <h3>营收与访问趋势</h3>
          <div class="legend">
            <span class="dot primary"></span> 营收
            <span class="dot accent"></span> 访问
          </div>
        </div>
        <svg class="plot" :viewBox="`0 0 ${CW} ${CH}`" preserveAspectRatio="none">
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.25" />
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <polygon :points="revenueArea" fill="url(#revFill)" />
          <polyline :points="revenueLine" fill="none" stroke="var(--primary)" stroke-width="2.5" />
          <polyline
            :points="sessionsLine"
            fill="none"
            stroke="var(--accent)"
            stroke-width="2.5"
            stroke-dasharray="5 4"
          />
        </svg>
        <div class="axis">
          <span v-for="m in months" :key="m">{{ m }}</span>
        </div>
      </section>

      <section class="card chart">
        <div class="chart-head">
          <h3>月度表现</h3>
          <div class="legend">
            <span class="dot primary"></span> 新增
            <span class="dot accent"></span> 续费
          </div>
        </div>
        <svg class="plot" :viewBox="`0 0 ${BW} ${BH}`" preserveAspectRatio="none">
          <g v-for="(_, i) in signups" :key="i">
            <rect
              :x="BPAD + i * groupW + groupW * 0.1"
              :y="barY(signups[i])"
              :width="barW"
              :height="barH(signups[i])"
              rx="2"
              fill="var(--primary)"
            />
            <rect
              :x="BPAD + i * groupW + groupW * 0.1 + barW + 3"
              :y="barY(renewals[i])"
              :width="barW"
              :height="barH(renewals[i])"
              rx="2"
              fill="var(--accent)"
            />
          </g>
        </svg>
        <div class="axis">
          <span v-for="m in months" :key="m">{{ m }}</span>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<style scoped>
.balance-row {
  display: grid;
  grid-template-columns: minmax(0, 320px);
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.charts {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 16px;
}

.chart {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chart-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.dot {
  width: 8px;
  height: 8px;
  display: inline-block;
  margin-left: 8px;
  border-radius: 2px;
}

.dot.primary {
  background: var(--primary);
}

.dot.accent {
  background: var(--accent);
}

.plot {
  width: 100%;
  height: 200px;
}

.axis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

@media (max-width: 1100px) {
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .charts {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .stats {
    grid-template-columns: 1fr;
  }

  .balance-row {
    grid-template-columns: 1fr;
  }
}
</style>
