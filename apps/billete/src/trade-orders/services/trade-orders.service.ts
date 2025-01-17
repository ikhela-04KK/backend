// tradeOrder.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'apps/billete/src/database/services/database/database.service';
import { BalancesService } from '../../wallets/services/balance.service';
import { BigNumber } from 'bignumber.js';
import { LambdaService } from '../../lambda/lambda.service';
import { KrakenGateway } from 'gateways/kraken.gateway';

@Injectable()
export class TradeOrdersService {
  private conversionGraph: Record<string, Record<string, number>> = {};
  private tickers = [
    'ETHUSDC',
    'ETHUSDT',
    'LTCETH',
    'LTCUSDT',
    'SOLETH',
    'SOLUSD',
    'SOLUSDT',
    'SOLXBT',
    'USDCUSD',
    'USDCUSDT',
    'XBTUSDC',
    'XBTUSDT',
    'XDGUSD',
    'XDGUSDT',
  ];

  private symbols = ['USD', 'USDC', 'USDT', 'XBT', 'XDG', 'ETH', 'SOL', 'LTC'];

  constructor(
    private databaseService: DatabaseService,
    private balanceService: BalancesService,
    private lambdaService: LambdaService,
    private krakenGateway: KrakenGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    this.createConversionGraph();
  }

  createConversionGraph() {
    this.conversionGraph = {};

    this.tickers.forEach((ticker) => {
      const symbolsInTicker = this.symbols.filter((symbol) =>
        ticker.includes(symbol),
      );
      if (symbolsInTicker.length == 2) {
        const [src, dst] = symbolsInTicker;

        if (!this.conversionGraph[src]) this.conversionGraph[src] = {};
        if (!this.conversionGraph[dst]) this.conversionGraph[dst] = {};

        this.conversionGraph[src][dst] = 1;
        this.conversionGraph[dst][src] = 1;
      }
    });
  }

  filterTickers(): string[] {
    return this.tickers.filter((ticker) => {
      const matches = this.symbols.filter((symbol) => ticker.includes(symbol));
      return matches.length === 2;
    });
  }

  async convert(
    userId: string,
    fromSymbol: string,
    toSymbol: string,
    fromAmount: string,
    toAmount: string,
  ) {
    try {
      console.log('fromSymbol', fromSymbol);
      console.log('toSymbol', toSymbol);
      const fromPriceData = this.krakenGateway.getPrice(fromSymbol);
      const toPriceData = this.krakenGateway.getPrice(toSymbol);
      if (!fromPriceData || !toPriceData) {
        throw new Error('Price data not available for symbols.');
      }

      // // Calcula el rango aceptable basado en el precio con spread
      // const expectedToAmount = new BigNumber(fromAmount)
      //   .dividedBy(fromPriceData.spreadPrice)
      //   .multipliedBy(toPriceData.spreadPrice);
      // const lowerBound = expectedToAmount.multipliedBy(new BigNumber('0.98'));
      // const upperBound = expectedToAmount.multipliedBy(new BigNumber('1.02'));

      // // Compara toAmount con el rango calculado
      // const actualToAmount = new BigNumber(toAmount);
      // if (
      //   actualToAmount.isLessThan(lowerBound) ||
      //   actualToAmount.isGreaterThan(upperBound)
      // ) {
      //   throw new Error('toAmount is out of the acceptable range.');
      // }
      const balances =
        await this.balanceService.getBalancesForUserByPlatform(userId);

      let remainingAmount = new BigNumber(fromAmount);

      balances.Kraken.forEach((balance) => {
        if (balance.symbol === fromSymbol) {
          const currentBalance = new BigNumber(balance.balance);
          if (currentBalance.gte(remainingAmount)) {
            balance.balance = currentBalance.minus(remainingAmount).toFixed(8);
            remainingAmount = new BigNumber(0);
          } else {
            balance.balance = '0';
            remainingAmount = remainingAmount.minus(currentBalance);
          }
        }
      });

      if (remainingAmount.gt(0)) {
        balances.Billete.forEach((balance) => {
          if (balance.symbol === fromSymbol) {
            const currentBalance = new BigNumber(balance.balance);
            if (currentBalance.gte(remainingAmount)) {
              balance.balance = currentBalance
                .minus(remainingAmount)
                .toFixed(8);
              remainingAmount = new BigNumber(0);
            } else {
              balance.balance = '0';
              remainingAmount = remainingAmount.minus(currentBalance);
            }
          }
        });
      }

      if (remainingAmount.gt(0)) {
        throw new Error('Insufficient funds for conversion.');
      }

      balances.Kraken.forEach((balance) => {
        if (balance.symbol === toSymbol) {
          balance.balance = new BigNumber(balance.balance)
            .plus(toAmount)
            .toString();
        }
      });
      await this.balanceService.updateBalancesForUser(
        userId,
        fromSymbol,
        toSymbol,
        balances,
      );
      return { success: true };
    } catch (error) {
      console.log(`Error: ${error}`);
      return { success: false, error: error };
    }
  }

  findConversionPath(source: string, target: string): string[] | null {
    const visited: Set<string> = new Set();
    const queue: { node: string; path: string[] }[] = [
      { node: source, path: [source] },
    ];

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;

      if (node === target) {
        return path;
      }

      visited.add(node);

      Object.keys(this.conversionGraph[node] || {}).forEach((neighbor) => {
        if (!visited.has(neighbor)) {
          queue.push({ node: neighbor, path: [...path, neighbor] });
        }
      });
    }

    return null;
  }

  async invokeConversion(path: string[], amount: string) {
    path.forEach(async (node, idx) => {
      if (idx < path.length - 1) {
        const payload = {
          amount,
          operation: 'convert',
          symbol: `${node}${path[idx + 1]}`,
        };

        await this.lambdaService.invokeLambdaFunction(
          'ConvertFromKraken',
          payload,
        );
      }
    });
  }
  // findAll(): Promise<TradeOrder[]> {
  //   return this.databaseService.tradeOrder.findMany();
  // }

  // findOne(id: string): Promise<TradeOrder | null> {
  //   return this.databaseService.tradeOrder.findUnique({
  //     where: { id },
  //   });
  // }

  // create(tradeOrderData: Prisma.TradeOrderCreateInput): Promise<TradeOrder> {
  //   return this.databaseService.tradeOrder.create({
  //     data: tradeOrderData,
  //   });
  // }

  // update(
  //   id: string,
  //   tradeOrderData: Prisma.TradeOrderUpdateInput,
  // ): Promise<TradeOrder> {
  //   return this.databaseService.tradeOrder.update({
  //     where: { id },
  //     data: tradeOrderData,
  //   });
  // }

  // async remove(id: string): Promise<void> {
  //   await this.databaseService.tradeOrder.delete({
  //     where: { id },
  //   });
  // }
}
