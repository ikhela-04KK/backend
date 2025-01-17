import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WithdrawDto {
  @IsNotEmpty()
  @IsString()
  from: string;
  @IsNotEmpty()
  @IsString()
  to: string;
  @IsNotEmpty()
  @IsString()
  amount: string;
  @IsNotEmpty()
  @IsString()
  coin: string;
  @IsOptional()
  @IsString()
  userId: string;
  @IsOptional()
  @IsString()
  blockchainId: string;
}
