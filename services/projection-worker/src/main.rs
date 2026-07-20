#![forbid(unsafe_code)]

use std::time::Duration;

use panshi_application::projection::{claim_batch, project_batch, quarantine_batch};
use panshi_event_store::PostgresEventStore;
use sqlx::postgres::PgPoolOptions;
use tracing::{error, info, warn};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "panshi_projection_worker=info".into()),
        )
        .init();
    let database_url = std::env::var("DATABASE_URL")?;
    let worker = std::env::var("PANSHI_WORKER_ID")
        .unwrap_or_else(|_| "projection-worker-local".into());
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await?;
    PostgresEventStore::migrate(&pool).await?;
    info!(worker, "projection worker started");

    loop {
        let Some(batch) = claim_batch(&pool, &worker).await? else {
            tokio::time::sleep(Duration::from_millis(150)).await;
            continue;
        };
        match project_batch(&pool, &worker, batch.clone()).await {
            Ok(()) => info!("projection batch applied"),
            Err(error) => {
                warn!(?error, "projection batch quarantined");
                if let Err(quarantine_error) =
                    quarantine_batch(&pool, &worker, &batch, "PROJECTION_VALIDATION_FAILED").await
                {
                    error!(?quarantine_error, "failed to quarantine projection batch");
                }
            }
        }
    }
}
