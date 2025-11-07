/**
 * Results Visualization Tool
 * Generates text-based visualizations of optimization results
 */

import * as fs from 'fs';
import * as path from 'path';

interface ResultsData {
  bestParameters: any;
  bestScore: number;
  totalTests: number;
  timeElapsed: number;
  topResults: Array<{
    score: number;
    parameters: any;
    scenarios: Array<{
      name: string;
      score: number;
      success: boolean;
      collisions: number;
      minDistance: number;
    }>;
  }>;
}

class ResultsVisualizer {
  /**
   * Generate a text-based visualization of results
   */
  static visualize(resultsPath: string): void {
    if (!fs.existsSync(resultsPath)) {
      console.error(`❌ Results file not found: ${resultsPath}`);
      process.exit(1);
    }

    const data: ResultsData = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));

    console.log('\n' + '═'.repeat(60));
    console.log('  AUTOPILOT OPTIMIZATION RESULTS SUMMARY');
    console.log('═'.repeat(60) + '\n');

    // Overall statistics
    this.printOverallStats(data);

    // Best parameters
    this.printBestParameters(data);

    // Scenario breakdown
    this.printScenarioBreakdown(data);

    // Score distribution
    this.printScoreDistribution(data);

    // Top configurations comparison
    this.printTopConfigurations(data);

    // Parameter sensitivity
    this.printParameterSensitivity(data);
  }

  private static printOverallStats(data: ResultsData): void {
    console.log('📊 Overall Statistics');
    console.log('─'.repeat(60));
    console.log(`Total tests run:      ${data.totalTests}`);
    console.log(`Time elapsed:         ${this.formatTime(data.timeElapsed)}`);
    console.log(`Best score achieved:  ${data.bestScore.toFixed(2)}/100`);
    console.log(`Tests per minute:     ${(data.totalTests / (data.timeElapsed / 60000)).toFixed(1)}`);
    console.log();
  }

  private static printBestParameters(data: ResultsData): void {
    console.log('🏆 Best Parameters Found');
    console.log('─'.repeat(60));

    const params = data.bestParameters;

    console.log('\nPosition Control:');
    console.log(`  Kp: ${params.positionKp.toFixed(3)}  Ki: ${params.positionKi.toFixed(4)}  Kd: ${params.positionKd.toFixed(3)}`);

    console.log('\nVelocity Control:');
    console.log(`  Kp: ${params.velocityKp.toFixed(3)}  Ki: ${params.velocityKi.toFixed(4)}  Kd: ${params.velocityKd.toFixed(3)}`);

    console.log('\nGuidance:');
    console.log(`  Max Approach Speed: ${params.maxApproachSpeed.toFixed(2)} m/s`);
    console.log(`  Braking Margin:     ${params.brakingMargin.toFixed(2)}x`);

    console.log('\nAlignment:');
    console.log(`  Gate On:  ${params.alignGateOnDeg.toFixed(1)}°`);
    console.log(`  Gate Off: ${params.alignGateOffDeg.toFixed(1)}°`);

    console.log('\nPath Planning:');
    console.log(`  Deviation Threshold: ${params.deviationThreshold.toFixed(2)} m`);
    console.log(`  Replan Interval:     ${params.replanInterval.toFixed(2)} s`);
    console.log();
  }

  private static printScenarioBreakdown(data: ResultsData): void {
    console.log('📋 Scenario Performance Breakdown');
    console.log('─'.repeat(60));

    const bestResult = data.topResults[0];

    for (const scenario of bestResult.scenarios) {
      const bar = this.createBar(scenario.score, 100, 30);
      const status = scenario.success ? '✓' : '✗';
      const collisionStr = scenario.collisions > 0 ? ` (${scenario.collisions} collisions)` : '';

      console.log(`${status} ${scenario.name.padEnd(20)} ${bar} ${scenario.score.toFixed(1)}${collisionStr}`);
    }
    console.log();
  }

  private static printScoreDistribution(data: ResultsData): void {
    console.log('📈 Score Distribution');
    console.log('─'.repeat(60));

    const scores = data.topResults.map(r => r.score);
    const bins = [0, 20, 40, 60, 80, 100];
    const distribution: number[] = new Array(bins.length - 1).fill(0);

    for (const score of scores) {
      for (let i = 0; i < bins.length - 1; i++) {
        if (score >= bins[i] && score < bins[i + 1]) {
          distribution[i]++;
          break;
        }
      }
    }

    const maxCount = Math.max(...distribution, 1);

    for (let i = 0; i < distribution.length; i++) {
      const range = `${bins[i]}-${bins[i + 1]}`.padEnd(8);
      const bar = this.createBar(distribution[i], maxCount, 40);
      const count = `(${distribution[i]})`.padStart(6);
      console.log(`${range} ${bar} ${count}`);
    }
    console.log();
  }

  private static printTopConfigurations(data: ResultsData): void {
    console.log('🥇 Top 5 Configurations');
    console.log('─'.repeat(60));

    const top5 = data.topResults.slice(0, 5);

    top5.forEach((result, index) => {
      console.log(`\n#${index + 1}  Score: ${result.score.toFixed(2)}/100`);

      const successCount = result.scenarios.filter(s => s.success).length;
      const collisionCount = result.scenarios.reduce((sum, s) => sum + s.collisions, 0);

      console.log(`     Success Rate: ${((successCount / result.scenarios.length) * 100).toFixed(0)}%`);
      console.log(`     Total Collisions: ${collisionCount}`);

      // Show key parameter differences from best
      if (index > 0) {
        const best = top5[0].parameters;
        const current = result.parameters;
        const diffs: string[] = [];

        if (Math.abs(best.velocityKp - current.velocityKp) > 0.1) {
          diffs.push(`velocityKp: ${current.velocityKp.toFixed(2)}`);
        }
        if (Math.abs(best.maxApproachSpeed - current.maxApproachSpeed) > 0.1) {
          diffs.push(`maxSpeed: ${current.maxApproachSpeed.toFixed(2)}`);
        }
        if (Math.abs(best.brakingMargin - current.brakingMargin) > 0.05) {
          diffs.push(`brakingMargin: ${current.brakingMargin.toFixed(2)}`);
        }

        if (diffs.length > 0) {
          console.log(`     Key differences: ${diffs.join(', ')}`);
        }
      }
    });
    console.log();
  }

  private static printParameterSensitivity(data: ResultsData): void {
    console.log('🔬 Parameter Sensitivity Analysis');
    console.log('─'.repeat(60));

    const allResults = data.topResults;
    const parameterNames = Object.keys(data.bestParameters);

    const sensitivities: Array<{ param: string; variance: number }> = [];

    for (const param of parameterNames) {
      const values = allResults.map(r => r.parameters[param]);
      const scores = allResults.map(r => r.score);

      // Calculate correlation between parameter value and score
      const variance = this.calculateVariance(values);
      sensitivities.push({ param, variance });
    }

    // Sort by variance (higher = more sensitive)
    sensitivities.sort((a, b) => b.variance - a.variance);

    console.log('\nMost sensitive parameters (larger variance = more impact on score):\n');

    for (let i = 0; i < Math.min(5, sensitivities.length); i++) {
      const s = sensitivities[i];
      const bar = this.createBar(s.variance, sensitivities[0].variance, 20);
      console.log(`  ${(i + 1)}. ${s.param.padEnd(22)} ${bar}`);
    }

    console.log('\nLeast sensitive parameters:\n');

    for (let i = Math.max(0, sensitivities.length - 3); i < sensitivities.length; i++) {
      const s = sensitivities[i];
      const bar = this.createBar(s.variance, sensitivities[0].variance, 20);
      console.log(`  ${sensitivities.length - i}. ${s.param.padEnd(22)} ${bar}`);
    }

    console.log();
  }

  private static createBar(value: number, max: number, width: number): string {
    const filled = Math.floor((value / max) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  private static calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private static formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// CLI
// Check if this is the main module (ES module compatible)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const args = process.argv.slice(2);
  const resultsPath = args[0] || path.join(process.cwd(), 'autopilot-optimization-results.json');

  ResultsVisualizer.visualize(resultsPath);
}

export { ResultsVisualizer };

