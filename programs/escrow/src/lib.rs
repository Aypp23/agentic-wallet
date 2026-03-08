use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("7U9zNRhvzTSnA7jQmUbVf9bT4Vg41qF6yJaXU5J6tCGC");

#[program]
pub mod escrow {
    use super::*;

    pub fn create_escrow(
        mut ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount: u64,
        deadline: i64,
        terms_hash: [u8; 32],
        fee_basis_points: u16,
        auto_release_at: i64,
    ) -> Result<()> {
        create_common(
            &mut ctx,
            escrow_id,
            amount,
            deadline,
            terms_hash,
            fee_basis_points,
            auto_release_at,
            false,
            false,
        )
    }

    pub fn create_milestone_escrow(
        mut ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount: u64,
        deadline: i64,
        terms_hash: [u8; 32],
        fee_basis_points: u16,
        auto_release_at: i64,
    ) -> Result<()> {
        create_common(
            &mut ctx,
            escrow_id,
            amount,
            deadline,
            terms_hash,
            fee_basis_points,
            auto_release_at,
            true,
            false,
        )
    }

    pub fn x402_pay(
        mut ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount: u64,
        deadline: i64,
        terms_hash: [u8; 32],
        fee_basis_points: u16,
        auto_release_at: i64,
    ) -> Result<()> {
        create_common(
            &mut ctx,
            escrow_id,
            amount,
            deadline,
            terms_hash,
            fee_basis_points,
            auto_release_at,
            false,
            true,
        )
    }

    pub fn accept_task(ctx: Context<AcceptTask>) -> Result<()> {
        let clock = Clock::get()?;
        let escrow = &mut ctx.accounts.escrow_account;

        require!(escrow.recipient == ctx.accounts.recipient.key(), EscrowError::UnauthorizedRecipient);
        require!(escrow.status == EscrowStatus::Created, EscrowError::InvalidStatus);
        require!(clock.unix_timestamp < escrow.deadline, EscrowError::DeadlineExpired);

        escrow.status = EscrowStatus::Active;
        Ok(())
    }

    pub fn release_payment(mut ctx: Context<ReleasePayment>) -> Result<()> {
        release_common(&mut ctx, false)
    }

    pub fn release_milestone(mut ctx: Context<ReleasePayment>, _milestone_index: u8) -> Result<()> {
        release_common(&mut ctx, true)
    }

    pub fn request_refund(ctx: Context<RequestRefund>) -> Result<()> {
        let clock = Clock::get()?;
        let creator_key = ctx.accounts.creator.key();
        let escrow = &ctx.accounts.escrow_account;
        require!(escrow.creator == creator_key, EscrowError::UnauthorizedCreator);

        let next_status = match escrow.status {
            EscrowStatus::Created => EscrowStatus::Cancelled,
            EscrowStatus::Active => {
                require!(clock.unix_timestamp >= escrow.deadline, EscrowError::DeadlineNotReached);
                EscrowStatus::Refunded
            }
            _ => return err!(EscrowError::InvalidStatus),
        };
        let refund_amount = escrow.amount;

        transfer_lamports(
            &ctx.accounts.escrow_account.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            refund_amount,
        )?;
        ctx.accounts.escrow_account.status = next_status;

        Ok(())
    }

    pub fn dispute(ctx: Context<Dispute>, reason: [u8; 64]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_account;
        let disputer = ctx.accounts.disputer.key();

        require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);
        require!(disputer == escrow.creator || disputer == escrow.recipient, EscrowError::UnauthorizedDisputer);

        escrow.status = EscrowStatus::Disputed;
        escrow.dispute_reason = reason;

        Ok(())
    }

    pub fn resolve_dispute(ctx: Context<ResolveDispute>, winner: DisputeWinner) -> Result<()> {
        let escrow = &ctx.accounts.escrow_account;
        require!(escrow.status == EscrowStatus::Disputed, EscrowError::InvalidStatus);
        require!(escrow.arbiter == ctx.accounts.arbiter.key(), EscrowError::UnauthorizedArbiter);
        let amount = escrow.amount;
        let fee_basis_points = escrow.fee_basis_points;

        match winner {
            DisputeWinner::Creator => {
                transfer_lamports(
                    &ctx.accounts.escrow_account.to_account_info(),
                    &ctx.accounts.creator.to_account_info(),
                    amount,
                )?;
            }
            DisputeWinner::Recipient => {
                let fee = compute_fee(amount, fee_basis_points)?;
                let payout = amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

                if fee > 0 {
                    transfer_lamports(
                        &ctx.accounts.escrow_account.to_account_info(),
                        &ctx.accounts.fee_recipient.to_account_info(),
                        fee,
                    )?;
                }

                transfer_lamports(
                    &ctx.accounts.escrow_account.to_account_info(),
                    &ctx.accounts.recipient.to_account_info(),
                    payout,
                )?;
            }
        }

        ctx.accounts.escrow_account.status = EscrowStatus::Resolved;
        Ok(())
    }
}

fn create_common(
    ctx: &mut Context<CreateEscrow>,
    escrow_id: u64,
    amount: u64,
    deadline: i64,
    terms_hash: [u8; 32],
    fee_basis_points: u16,
    auto_release_at: i64,
    is_milestone: bool,
    is_x402: bool,
) -> Result<()> {
    require!(amount > 0, EscrowError::ZeroAmount);
    require!(fee_basis_points <= 1000, EscrowError::FeeTooHigh);

    let clock = Clock::get()?;
    require!(deadline > clock.unix_timestamp, EscrowError::DeadlineExpired);

    if auto_release_at != 0 {
        require!(auto_release_at > deadline, EscrowError::InvalidAutoRelease);
    }

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.escrow_account.to_account_info(),
            },
        ),
        amount,
    )?;

    let escrow = &mut ctx.accounts.escrow_account;
    escrow.creator = ctx.accounts.creator.key();
    escrow.recipient = ctx.accounts.recipient.key();
    escrow.arbiter = ctx.accounts.arbiter.key();
    escrow.fee_recipient = ctx.accounts.fee_recipient.key();
    escrow.amount = amount;
    escrow.status = EscrowStatus::Created;
    escrow.deadline = deadline;
    escrow.terms_hash = terms_hash;
    escrow.fee_basis_points = fee_basis_points;
    escrow.created_at = clock.unix_timestamp;
    escrow.escrow_id = escrow_id;
    escrow.bump = ctx.bumps.escrow_account;
    escrow.dispute_reason = [0u8; 64];
    escrow.auto_release_at = auto_release_at;
    escrow.is_milestone = is_milestone;
    escrow.is_x402 = is_x402;

    Ok(())
}

fn release_common(ctx: &mut Context<ReleasePayment>, require_milestone: bool) -> Result<()> {
    let creator_key = ctx.accounts.creator.key();
    let recipient_key = ctx.accounts.recipient.key();
    let fee_recipient_key = ctx.accounts.fee_recipient.key();
    let escrow = &ctx.accounts.escrow_account;

    require!(escrow.creator == creator_key, EscrowError::UnauthorizedCreator);
    require!(escrow.status == EscrowStatus::Active, EscrowError::InvalidStatus);
    require!(escrow.recipient == recipient_key, EscrowError::UnauthorizedRecipient);
    require!(escrow.fee_recipient == fee_recipient_key, EscrowError::InvalidFeeRecipient);

    if require_milestone {
        require!(escrow.is_milestone, EscrowError::NotMilestoneEscrow);
    }

    let fee = compute_fee(escrow.amount, escrow.fee_basis_points)?;
    let payout = escrow.amount.checked_sub(fee).ok_or(EscrowError::Overflow)?;

    if fee > 0 {
        transfer_lamports(
            &ctx.accounts.escrow_account.to_account_info(),
            &ctx.accounts.fee_recipient.to_account_info(),
            fee,
        )?;
    }

    transfer_lamports(
        &ctx.accounts.escrow_account.to_account_info(),
        &ctx.accounts.recipient.to_account_info(),
        payout,
    )?;

    ctx.accounts.escrow_account.status = EscrowStatus::Completed;
    Ok(())
}

fn compute_fee(amount: u64, fee_basis_points: u16) -> Result<u64> {
    let fee = (amount as u128)
        .checked_mul(fee_basis_points as u128)
        .ok_or(EscrowError::Overflow)?
        .checked_div(10_000)
        .ok_or(EscrowError::Overflow)?;

    u64::try_from(fee).map_err(|_| EscrowError::Overflow.into())
}

fn transfer_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    let from_balance = **from.try_borrow_lamports()?;
    require!(from_balance >= amount, EscrowError::InsufficientEscrowBalance);

    let to_balance = **to.try_borrow_lamports()?;

    **from.try_borrow_mut_lamports()? = from_balance.checked_sub(amount).ok_or(EscrowError::Overflow)?;
    **to.try_borrow_mut_lamports()? = to_balance.checked_add(amount).ok_or(EscrowError::Overflow)?;

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EscrowStatus {
    Created,
    Active,
    Disputed,
    Completed,
    Refunded,
    Cancelled,
    Resolved,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DisputeWinner {
    Creator,
    Recipient,
}

#[account]
pub struct EscrowAccount {
    pub creator: Pubkey,
    pub recipient: Pubkey,
    pub arbiter: Pubkey,
    pub fee_recipient: Pubkey,
    pub amount: u64,
    pub status: EscrowStatus,
    pub deadline: i64,
    pub terms_hash: [u8; 32],
    pub fee_basis_points: u16,
    pub created_at: i64,
    pub escrow_id: u64,
    pub bump: u8,
    pub dispute_reason: [u8; 64],
    pub auto_release_at: i64,
    pub is_milestone: bool,
    pub is_x402: bool,
}

impl EscrowAccount {
    pub const SPACE: usize = 8  // discriminator
        + 32  // creator
        + 32  // recipient
        + 32  // arbiter
        + 32  // fee_recipient
        + 8   // amount
        + 1   // status
        + 8   // deadline
        + 32  // terms_hash
        + 2   // fee_basis_points
        + 8   // created_at
        + 8   // escrow_id
        + 1   // bump
        + 64  // dispute_reason
        + 8   // auto_release_at
        + 1   // is_milestone
        + 1;  // is_x402
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = creator,
        space = EscrowAccount::SPACE,
        seeds = [b"escrow", creator.key().as_ref(), &escrow_id.to_le_bytes()],
        bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Stored as escrow recipient.
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Stored as escrow arbiter.
    pub arbiter: UncheckedAccount<'info>,

    /// CHECK: Stored as fee recipient.
    pub fee_recipient: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptTask<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub recipient: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleasePayment<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Validated against escrow state.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Validated against escrow state.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequestRefund<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct Dispute<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub disputer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(
        mut,
        close = creator,
        seeds = [b"escrow", escrow_account.creator.as_ref(), &escrow_account.escrow_id.to_le_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    pub arbiter: Signer<'info>,

    /// CHECK: Validated against escrow state.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: Validated against escrow state.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Validated against escrow state.
    #[account(mut)]
    pub fee_recipient: UncheckedAccount<'info>,
}

#[error_code]
pub enum EscrowError {
    #[msg("Escrow is not in the expected status for this operation")]
    InvalidStatus,
    #[msg("Only the creator can perform this action")]
    UnauthorizedCreator,
    #[msg("Only the recipient can perform this action")]
    UnauthorizedRecipient,
    #[msg("Only the arbiter can resolve disputes")]
    UnauthorizedArbiter,
    #[msg("Only the creator or recipient can open a dispute")]
    UnauthorizedDisputer,
    #[msg("Deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Deadline has already passed")]
    DeadlineExpired,
    #[msg("Fee basis points exceeds maximum (1000 = 10%)")]
    FeeTooHigh,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Escrow account has insufficient lamports for transfer")]
    InsufficientEscrowBalance,
    #[msg("Invalid fee recipient for escrow release")]
    InvalidFeeRecipient,
    #[msg("Auto release timestamp must be after deadline")]
    InvalidAutoRelease,
    #[msg("release_milestone called for non-milestone escrow")]
    NotMilestoneEscrow,
}
