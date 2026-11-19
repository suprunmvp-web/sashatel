output "api_vm_id" { value = yandex_compute_instance.api.id }
output "api_private_ip" { value = yandex_compute_instance.api.network_interface[0].ip_address }
output "postgres_cluster_id" { value = yandex_mdb_postgresql_cluster_v2.db.id }
output "network_id" { value = yandex_vpc_network.environment.id }
