import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { hash, verify } from 'argon2';
import { AuthDTO } from 'src/auth/dtos/auth.dto';
import { SignTokenDTO } from 'src/auth/dtos/sign-token.dto';
import { DatabaseService } from 'src/database/services/database/database.service';
import { UtxoWalletService } from 'src/wallets/services/utxo-wallet.service';
import { EvmWalletService } from 'src/wallets/services/evm-wallet.service';

@Injectable()
export class AuthService {
  constructor(
    private databaseService: DatabaseService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private evmWalletService: EvmWalletService,
    private utxoWalletService: UtxoWalletService,
  ) {}

  async signUpUser(authDto: AuthDTO): Promise<{ userId: string }> {
    try {
      const encryptedPassword = await hash(authDto.password);

      const userData = {
        email: authDto.email,
        phoneNumber: authDto.phoneNumber,
        firstName: authDto.firstName,
        lastName: authDto.lastName,
        encryptedPassword: encryptedPassword,
      };

      const user = await this.databaseService.user.create({
        data: userData,
      });

      const allowedChains = this.configService
        .get('ALLOWED_CHAINS_IDS')
        .split(',');

      for (const chainId of allowedChains) {
        await this.evmWalletService.createWallet(user.id, chainId);
      }

      await this.utxoWalletService.createWallet(user.id, 'bitcoin', 'mainnet');
      await this.utxoWalletService.createWallet(user.id, 'bitcoin', 'testnet');
      await this.utxoWalletService.createWallet(user.id, 'litecoin', 'mainnet');
      await this.utxoWalletService.createWallet(user.id, 'litecoin', 'testnet');
      await this.utxoWalletService.createWallet(user.id, 'dogecoin', 'mainnet');
      await this.utxoWalletService.createWallet(user.id, 'dogecoin', 'testnet');
      return {
        userId: user.id,
      };
    } catch (error) {
      if (error instanceof PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ForbiddenException('Credentials already in use.');
        }
      }
      throw error;
    }
  }

  async signInUser(authDto: AuthDTO): Promise<{ userId: string }> {
    const user = await this.databaseService.user.findFirst({
      where: {
        OR: [{ email: authDto.email }, { phoneNumber: authDto.phoneNumber }],
      },
    });

    console.log('user', user);

    if (!user) {
      throw new ForbiddenException('Invalid credentials.');
    }

    const isPasswordValid = await verify(
      user.encryptedPassword,
      authDto.password,
    );

    if (!isPasswordValid) {
      throw new ForbiddenException('Invalid credentials.');
    }

    return {
      userId: user.id,
    };
  }

  async signToken(signTokenDto: SignTokenDTO): Promise<string> {
    const payload = {
      sub: signTokenDto.userId,
    };

    const secret = this.configService.get<string>('JWT_SECRET');
    return this.jwtService.signAsync(payload, {
      expiresIn: '2d',
      secret: secret,
    });
  }
}
