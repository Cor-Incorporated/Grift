"""Cloud Function to resize GKE GPU node pool autoscaling.

Triggered by Cloud Scheduler to scale GPU nodes down at night/weekends
and back up during business hours for cost optimization.
"""

import json
import os

import flask
import functions_framework
from google.cloud import container_v1


@functions_framework.http
def resize_gpu_pool(request: flask.Request) -> flask.Response:
    """Resize the GPU node pool max_node_count.

    Expected JSON body:
        {
            "action": "scale_down" | "scale_up",
            "max_nodes": int
        }
    """
    project_id = os.environ["PROJECT_ID"]
    region = os.environ["REGION"]
    cluster_name = os.environ["CLUSTER_NAME"]
    node_pool_name = os.environ["NODE_POOL_NAME"]

    try:
        body = request.get_json(silent=True) or {}
    except Exception:
        return flask.Response(
            json.dumps({"error": "Invalid JSON body"}),
            status=400,
            mimetype="application/json",
        )

    action = body.get("action", "scale_down")
    max_nodes = int(body.get("max_nodes", 0))

    if max_nodes < 0 or max_nodes > 10:
        return flask.Response(
            json.dumps({"error": "max_nodes must be between 0 and 10"}),
            status=400,
            mimetype="application/json",
        )

    client = container_v1.ClusterManagerClient()

    node_pool_path = (
        f"projects/{project_id}/locations/{region}"
        f"/clusters/{cluster_name}/nodePools/{node_pool_name}"
    )

    node_pool = client.get_node_pool(name=node_pool_path)

    current_max = node_pool.autoscaling.max_node_count

    if current_max == max_nodes:
        return flask.Response(
            json.dumps({
                "status": "no_change",
                "action": action,
                "max_nodes": max_nodes,
                "message": f"Node pool already at max_nodes={max_nodes}",
            }),
            status=200,
            mimetype="application/json",
        )

    update_request = container_v1.SetNodePoolAutoscalingRequest(
        name=node_pool_path,
        autoscaling=container_v1.NodePoolAutoscaling(
            enabled=True,
            min_node_count=0,
            max_node_count=max_nodes,
        ),
    )

    operation = client.set_node_pool_autoscaling(request=update_request)

    return flask.Response(
        json.dumps({
            "status": "success",
            "action": action,
            "max_nodes": max_nodes,
            "previous_max": current_max,
            "operation": operation.name,
        }),
        status=200,
        mimetype="application/json",
    )
