// OpenTelemetry Rust instrumentation for auth-service
use opentelemetry::{global, trace::TracerProvider as _};
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::{trace::TracerProvider, Resource};
use std::time::Duration;

fn init_tracer() -> Result<TracerProvider, Box<dyn std::error::Error + Send + Sync + 'static>> {
    let exporter = opentelemetry_otlp::new_exporter()
        .http()
        .with_endpoint("http://localhost:4318/v1/traces")
        .with_timeout(Duration::from_secs(30));

    let provider = TracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_resource(
            Resource::builder()
                .with_service_name("auth-service")
                .build(),
        )
        .build();

    global::set_tracer_provider(provider.clone());
    Ok(provider)
}

fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync + 'static>> {
    let provider = init_tracer()?;

    // Your service code here
    let _tracer = global::tracer("auth-service");

    // Shutdown
    provider.shutdown()?;
    Ok(())
}
