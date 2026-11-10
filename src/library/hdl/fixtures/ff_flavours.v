// HDL-9: the flip-flops HDL-1 lacks — separate asynchronous set and reset ($dffsr, with an
// enable $dffsre), an asynchronous load of a value ($aldff, $aldffe) — a reset value with an x
// bit, and a latch with set and reset.
module ff_flavours (
    input clk, input rst, input set, input en, input load, input g, input [3:0] d,
    input [3:0] ad,
    output reg [3:0] q_sr, output reg [3:0] q_sre, output reg [3:0] q_ald, output reg [3:0] q_alde,
    output reg [3:0] q_x, output reg [3:0] lat_sr
);
  always @(posedge clk or posedge rst or posedge set)
    if (rst) q_sr <= 4'h0; else if (set) q_sr <= 4'hf; else q_sr <= d;
  always @(posedge clk or posedge rst or posedge set)
    if (rst) q_sre <= 4'h0; else if (set) q_sre <= 4'hf; else if (en) q_sre <= d;
  always @(posedge clk or posedge load) if (load) q_ald <= ad; else q_ald <= d;
  always @(posedge clk or posedge load) if (load) q_alde <= ad; else if (en) q_alde <= d;
  always @(posedge clk or negedge rst) if (!rst) q_x <= 4'b10x1; else q_x <= d;
  always @* if (rst) lat_sr = 4'h0; else if (set) lat_sr = 4'hf; else if (g) lat_sr = d;
endmodule
