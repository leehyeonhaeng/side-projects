data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = "${var.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = var.log_retention_days
}

# 자기 로그 그룹에만 쓰기 허용 (AWSLambdaBasicExecutionRole보다 좁게)
data "aws_iam_policy_document" "logs" {
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }
}

resource "aws_iam_role_policy" "logs" {
  name   = "logs"
  role   = aws_iam_role.this.id
  policy = data.aws_iam_policy_document.logs.json
}

# 함수별 권한 (DynamoDB, Cognito 관리, Bedrock 등)
resource "aws_iam_role_policy" "extra" {
  name   = "extra"
  role   = aws_iam_role.this.id
  policy = var.policy_json
}

resource "aws_lambda_function" "this" {
  function_name    = var.function_name
  role             = aws_iam_role.this.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = var.handler
  filename         = var.package_path
  source_code_hash = var.package_hash
  memory_size      = var.memory_size
  timeout          = var.timeout
  layers           = var.layers

  environment {
    variables = merge(
      {
        POWERTOOLS_SERVICE_NAME = var.service
        POWERTOOLS_LOG_LEVEL    = "INFO"
      },
      var.environment,
    )
  }

  depends_on = [aws_cloudwatch_log_group.this, aws_iam_role_policy.logs]
}
