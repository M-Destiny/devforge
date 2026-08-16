# Override defaults with terraform.tfvars or by passing -var flags.
aws_region          = "us-east-1"
cluster_name        = "test-platform"
kubernetes_version  = "1.29"
node_instance_type  = "m6i.large"
node_min_size       = 2
node_max_size       = 10
node_desired_size   = 3
